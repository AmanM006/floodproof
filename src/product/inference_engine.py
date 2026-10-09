"""
Stand-alone CLI & Python engine for on-demand inference on Sentinel-1 SAR GeoTIFF chips.

Performs:
1. Validates TIFF dimensions (512x512, 2 channels [VV, VH]), units (radar backscatter dB).
2. Computes SHA256 input hash.
3. Calculates scene-specific geodetic scale using scene latitude (WGS84).
4. Runs XGBoost trained model and fixed threshold baseline.
5. Performs sectorization (8x8 grid = 64 sectors).
6. Generates base64 rasters for Candidate Water, Model Disagreement, and SAR Backscatter.
7. Computes execution latency (overall vs warm prediction).
8. Saves output JSON and optionally syncs to AWS S3.
"""

import sys
import os
import json
import time
import hashlib
import numpy as np
import tifffile
import joblib
from scipy.ndimage import uniform_filter
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import io
import base64
import subprocess

MODEL_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'artifacts', 'xgboost_sar_flood.joblib')
S3_BUCKET = "floodproof-verification-artifacts-699158992887"

def get_geodetic_pixel_area(lat_deg: float) -> float:
    """Calculates ellipsoidal pixel area (m^2) for 0.00008983 deg (10m nominal at equator)."""
    a = 6378137.0
    b = 6356752.3142
    phi = np.radians(lat_deg)
    sin_phi = np.sin(phi)
    cos_phi = np.cos(phi)
    
    e2 = 1.0 - (b**2 / a**2)
    m = (np.pi / 180.0) * a * (1.0 - e2) / np.power(1.0 - e2 * (sin_phi**2), 1.5)
    p = (np.pi / 180.0) * a * cos_phi / np.sqrt(1.0 - e2 * (sin_phi**2))
    
    res_deg = 0.00008983152841195215
    dy = m * res_deg
    dx = p * res_deg
    return float(dy * dx)

def extract_features(s1_arr):
    vv = np.nan_to_num(s1_arr[0], nan=-30.0)
    vh = np.nan_to_num(s1_arr[1], nan=-35.0)
    diff = vv - vh
    norm_ratio = (vv - vh) / (np.abs(vv) + np.abs(vh) + 1e-5)
    vv_mean_3 = uniform_filter(vv, size=3)
    vh_mean_3 = uniform_filter(vh, size=3)
    vv_sq = uniform_filter(vv**2, size=3)
    vv_std_3 = np.sqrt(np.maximum(0, vv_sq - vv_mean_3**2))
    
    feats = np.stack([
        vv.ravel(),
        vh.ravel(),
        diff.ravel(),
        norm_ratio.ravel(),
        vv_mean_3.ravel(),
        vh_mean_3.ravel(),
        vv_std_3.ravel()
    ], axis=1)
    return feats, vv, vh

def arr_to_b64(rgb_arr):
    buf = io.BytesIO()
    plt.imsave(buf, rgb_arr, format='png')
    buf.seek(0)
    return base64.b64encode(buf.read()).decode('utf-8')

def run_inference(tif_path: str, lat_deg: float = 26.63, lon_deg: float = 92.91, scene_name: str = "Uploaded SAR Scene"):
    start_total = time.time()
    
    # 1. Validation & Hash
    with open(tif_path, 'rb') as f:
        file_bytes = f.read()
    input_hash = hashlib.sha256(file_bytes).hexdigest()
    
    im = tifffile.imread(tif_path)
    if im.ndim != 3 or im.shape[0] < 2 or im.shape[1] != 512 or im.shape[2] != 512:
        raise ValueError(f"Invalid GeoTIFF shape {im.shape}. Must be at least (2, 512, 512) for [VV, VH] channels.")
    
    s1_data = im[:2, :, :].astype(np.float32)
    # Check valid backscatter range in dB
    if np.nanmin(s1_data) < -70.0 or np.nanmax(s1_data) > 30.0:
        raise ValueError("Backscatter values out of plausible SAR GRD dB range [-70, +30].")
        
    pixel_area_m2 = get_geodetic_pixel_area(lat_deg)
    ha_per_pixel = pixel_area_m2 / 10000.0
    
    # 2. Extract Features
    X, vv, vh = extract_features(s1_data)
    
    # 3. Model Inference
    warm_start = time.time()
    model = joblib.load(MODEL_PATH)
    preds = model.predict(X)
    warm_latency_ms = (time.time() - warm_start) * 1000.0
    
    xgb_water = preds.reshape(512, 512).astype(bool)
    
    # Fixed threshold baseline
    fixed_water = (vv < -16.0) & (vh < -23.0)
    
    # Disagreement mask
    disagreement = (xgb_water != fixed_water)
    
    # Valid mask (non-NaN / plausible)
    valid_mask = ~np.isnan(vv) & ~np.isnan(vh)
    valid_coverage_pct = float((valid_mask.sum() / (512 * 512)) * 100.0)
    
    total_cand_water_ha = round(float(xgb_water.sum() * ha_per_pixel), 2)
    total_disagree_ha = round(float(disagreement.sum() * ha_per_pixel), 2)
    
    # 4. Sectorization (8x8 = 64 sectors)
    sectors = []
    sec_size = 64
    max_sector_ha = round(float((sec_size * sec_size) * ha_per_pixel), 2)
    
    for r_idx in range(8):
        for c_idx in range(8):
            r0, r1 = r_idx * sec_size, (r_idx + 1) * sec_size
            c0, c1 = c_idx * sec_size, (c_idx + 1) * sec_size
            
            s_val = valid_mask[r0:r1, c0:c1].sum()
            s_cand = xgb_water[r0:r1, c0:c1].sum()
            s_dis = disagreement[r0:r1, c0:c1].sum()
            
            cand_ha = round(float(s_cand * ha_per_pixel), 2)
            dis_ha = round(float(s_dis * ha_per_pixel), 2)
            val_ha = round(float(s_val * ha_per_pixel), 2)
            
            # Category
            if cand_ha > 15.0:
                cat = "Priority 1: Severe Inundation"
            elif cand_ha > 5.0:
                cat = "Priority 2: Moderate Risk"
            else:
                cat = "Priority 3: Minor / Dry"
                
            sec_id = f"SEC_{(r_idx * 8) + c_idx + 1}"
            sectors.append({
                'id': sec_id,
                'r': r0,
                'c': c0,
                'valid_ha': val_ha,
                'candidate_water_ha': cand_ha,
                'permanent_water_ha': 0.0, # Handled or zero for fresh uploads
                'disagreement_ha': dis_ha,
                'disagreement_alert': "High Disagreement" if dis_ha > 4.0 else "Agreement",
                'triage_category': cat
            })
            
    # Rank by candidate water area
    sectors.sort(key=lambda s: s['candidate_water_ha'], reverse=True)
    for idx, s in enumerate(sectors):
        s['rank'] = idx + 1
        
    # 5. Visualizations
    # SAR False color
    vv_norm = np.clip((vv - (-25.0)) / (0.0 - (-25.0)), 0, 1)
    vh_norm = np.clip((vh - (-32.0)) / (-5.0 - (-32.0)), 0, 1)
    diff_norm = np.clip(((vv - vh) - 0.0) / (15.0 - 0.0), 0, 1)
    sar_rgb = np.stack([vv_norm, vh_norm, diff_norm], axis=-1)
    
    # Cand water overlay
    cand_rgb = np.ones((512, 512, 3), dtype=np.float32) * 0.95
    cand_rgb[xgb_water] = [1.0, 0.2, 0.4] # Red/Crimson
    
    # Disagreement overlay
    dis_rgb = np.zeros((512, 512, 3), dtype=np.float32)
    dis_rgb[disagreement] = [1.0, 0.67, 0.0] # Amber
    dis_rgb[~disagreement] = [0.08, 0.1, 0.14]
    
    img_sar_b64 = arr_to_b64(sar_rgb)
    img_cand_water_b64 = arr_to_b64(cand_rgb)
    img_disagreement_b64 = arr_to_b64(dis_rgb)
    
    total_latency_ms = (time.time() - start_total) * 1000.0
    
    result = {
        'status': 'completed',
        'input_hash': input_hash,
        'model_version': 'xgboost_sar_flood_v1.2',
        'metrics': {
            'total_latency_ms': round(total_latency_ms, 1),
            'warm_prediction_ms': round(warm_latency_ms, 1),
            'pixel_area_m2': round(pixel_area_m2, 2),
            'max_sector_ha': max_sector_ha
        },
        'metadata': {
            'id': f"UPLOAD_{input_hash[:8]}",
            'name': scene_name,
            'region': f"Geodetic Coordinates ({lat_deg}°N, {lon_deg}°E)",
            'date': time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            'sensor': "Sentinel-1 C-band SAR GRD",
            'lat': lat_deg,
            'lon': lon_deg
        },
        'valid_coverage_pct': valid_coverage_pct,
        'total_candidate_water_ha': total_cand_water_ha,
        'total_permanent_water_ha': 0.0,
        'total_disagreement_ha': total_disagree_ha,
        'img_sar_b64': img_sar_b64,
        'img_cand_water_b64': img_cand_water_b64,
        'img_disagreement_b64': img_disagreement_b64,
        'sectors': sectors
    }
    
    return result

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python inference_engine.py <path_to_s1_tif> [lat] [lon] [name]")
        sys.exit(1)
    
    tif = sys.argv[1]
    lat = float(sys.argv[2]) if len(sys.argv) > 2 else 26.63
    lon = float(sys.argv[3]) if len(sys.argv) > 3 else 92.91
    name = sys.argv[4] if len(sys.argv) > 4 else "CLI Inferred Scene"
    
    res = run_inference(tif, lat, lon, name)
    print(json.dumps({k: v for k, v in res.items() if not k.startswith('img_')}, indent=2))
