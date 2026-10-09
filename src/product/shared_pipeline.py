"""
Unified FloodProof Shared Core Pipeline.

Provides:
1. Polarimetric SAR feature extraction (VV, VH, diff, normalized ratio, local 3x3 context stats)
2. Strict validity masking (NaN / Inf / out-of-bounds filtering BEFORE any imputation)
3. Model prediction (XGBoost) and fixed threshold baseline
4. Permanent water baseline integration (JRC) with fallback status
5. Model disagreement mask
6. Geodetic WGS84 area calculation from TIFF geotransform & latitude
7. Sectorization (8x8 grid = 64 sectors) without artificial capping
8. High-contrast transparent RGBA PNG overlays (alpha channels for genuine overlaying)
"""

import os
import io
import time
import base64
import hashlib
import numpy as np
import tifffile
import joblib
from scipy.ndimage import uniform_filter
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

MODEL_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'artifacts', 'xgboost_sar_flood.joblib')

def parse_geotiff_metadata(tif_path: str):
    """
    Extracts actual geographic CRS, tiepoint, scale, and bounding box from GeoTIFF.
    Strictly enforces georeferencing tags and rejects unreferenced, rotated, or unsupported rasters.
    """
    with tifffile.TiffFile(tif_path) as tif:
        page = tif.pages[0]
        tags = {tag.name: tag.value for tag in page.tags}
        
        # Audit Check: Explicitly reject rasters lacking georeferencing tags
        if 'ModelPixelScaleTag' not in tags:
            raise ValueError(
                f"Missing georeferencing metadata: 'ModelPixelScaleTag' not found in {os.path.basename(tif_path)}. "
                "Unreferenced rasters cannot be safely processed."
            )
        if 'ModelTiepointTag' not in tags:
            raise ValueError(
                f"Missing georeferencing metadata: 'ModelTiepointTag' not found in {os.path.basename(tif_path)}. "
                "Tiepoint ground coordinates are required."
            )
        
        # Check for ModelTransformationTag (indicates sheared/rotated matrix)
        if 'ModelTransformationTag' in tags:
            raise ValueError(
                f"Rotated or sheared GeoTIFF detected via 'ModelTransformationTag' in {os.path.basename(tif_path)}. "
                "Only standard north-up rasters (ModelPixelScaleTag + ModelTiepointTag) are supported."
            )
        
        scale = tags['ModelPixelScaleTag']
        tiepoint = tags['ModelTiepointTag']
        
        if len(scale) < 2 or scale[0] <= 0 or scale[1] <= 0:
            raise ValueError(f"Invalid pixel scale {scale} in {os.path.basename(tif_path)}.")
        if len(tiepoint) < 6:
            raise ValueError(f"Invalid tiepoint {tiepoint} in {os.path.basename(tif_path)}.")
        
        # Tiepoint: (i, j, k, x, y, z)
        # Standard north-up GeoTIFFs tie pixel (0,0) to upper-left (origin_x, origin_y).
        # If raster tiepoint offset (i, j) is nonzero, correctly calculate the actual raster origin (0, 0):
        # origin_x = x - i * res_x, origin_y = y + j * res_y
        tie_i = float(tiepoint[0])
        tie_j = float(tiepoint[1])
        res_x = float(scale[0])
        res_y = float(scale[1])

        origin_x = float(tiepoint[3]) - (tie_i * res_x)
        origin_y = float(tiepoint[4]) + (tie_j * res_y)
        
        # Center coordinates for a 512x512 raster
        center_lon = origin_x + (512 * res_x) / 2.0
        center_lat = origin_y - (512 * res_y) / 2.0
        
        # Strict CRS Validation: Strictly require explicit geographic WGS84 (EPSG:4326)
        crs = None
        if 'GeoKeyDirectoryTag' in tags:
            geokeys = tags['GeoKeyDirectoryTag']
            for idx in range(4, len(geokeys), 4):
                key_id = geokeys[idx]
                key_val = geokeys[idx + 3]
                if key_id == 2048: # GeographicTypeGeoKey
                    crs = f"EPSG:{key_val}"
                    if key_val != 4326:
                        raise ValueError(
                            f"Unsupported geographic datum {crs} in {os.path.basename(tif_path)}. "
                            "FloodProof strictly requires standard geographic WGS84 (EPSG:4326)."
                        )
                elif key_id == 3072: # ProjectedCSTypeGeoKey
                    raise ValueError(
                        f"Unsupported projected CRS EPSG:{key_val} in {os.path.basename(tif_path)}. "
                        "FloodProof requires geographic WGS84 (EPSG:4326) coordinates."
                    )
        
        if not crs and 'GeoAsciiParamsTag' in tags:
            ascii_params = str(tags['GeoAsciiParamsTag']).upper()
            if "WGS 84" in ascii_params or "WGS84" in ascii_params or "EPSG 4326" in ascii_params:
                crs = "EPSG:4326"
            else:
                raise ValueError(
                    f"Unsupported geographic datum '{tags['GeoAsciiParamsTag']}' in {os.path.basename(tif_path)}. "
                    "FloodProof strictly requires geographic WGS84 (EPSG:4326)."
                )

        if not crs:
            raise ValueError(
                f"Missing explicit CRS definition in {os.path.basename(tif_path)}. "
                "GeoTIFF must explicitly specify EPSG:4326 (WGS84). Defaulting to unverified CRS is prohibited."
            )
        
        # Reject coordinates outside valid lat/lon ranges [-90..90], [-180..180]
        if not (-90.0 <= center_lat <= 90.0 and -180.0 <= center_lon <= 180.0):
            raise ValueError(
                f"Coordinates outside geographic bounds (lat: {center_lat}, lon: {center_lon}). "
                "Projected coordinate systems are not supported without reprojection."
            )
                    
        return {
            'origin_lon': float(origin_x),
            'origin_lat': float(origin_y),
            'res_deg_x': float(res_x),
            'res_deg_y': float(res_y),
            'center_lon': round(float(center_lon), 4),
            'center_lat': round(float(center_lat), 4),
            'crs': crs
        }

def compute_geodetic_pixel_area(lat_deg: float, res_deg_x: float, res_deg_y: float) -> float:
    """Calculates true WGS84 ellipsoidal pixel area in square meters."""
    a = 6378137.0
    b = 6356752.3142
    phi = np.radians(lat_deg)
    sin_phi = np.sin(phi)
    cos_phi = np.cos(phi)
    
    e2 = 1.0 - (b**2 / a**2)
    m = (np.pi / 180.0) * a * (1.0 - e2) / np.power(1.0 - e2 * (sin_phi**2), 1.5)
    p = (np.pi / 180.0) * a * cos_phi / np.sqrt(1.0 - e2 * (sin_phi**2))
    
    dy = m * res_deg_y
    dx = p * res_deg_x
    return float(dy * dx)

def compute_valid_mask(raw_vv, raw_vh):
    """Determines genuine valid radar pixels BEFORE imputation."""
    valid_vv = np.isfinite(raw_vv) & (raw_vv >= -70.0) & (raw_vv <= 30.0)
    valid_vh = np.isfinite(raw_vh) & (raw_vh >= -70.0) & (raw_vh <= 30.0)
    return valid_vv & valid_vh

def extract_features(s1_data, valid_mask):
    """Extracts 7 polarimetric and contextual features with raw validity preservation."""
    vv_raw = s1_data[0]
    vh_raw = s1_data[1]
    
    # Fill invalid only for convolution stability, retaining mask for outputs
    vv = np.where(valid_mask, vv_raw, -30.0)
    vh = np.where(valid_mask, vh_raw, -35.0)
    
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

def rgba_to_b64(rgba_arr):
    """Converts (H, W, 4) uint8 array to base64 PNG data."""
    buf = io.BytesIO()
    plt.imsave(buf, rgba_arr, format='png')
    buf.seek(0)
    return base64.b64encode(buf.read()).decode('utf-8')

def run_pipeline(s1_tif_path: str, jrc_tif_path: str = None, scene_name: str = None):
    """Executes the canonical, unified FloodProof processing pipeline."""
    timings = {}
    t0 = time.time()
    
    # 1. Validation & Hash
    with open(s1_tif_path, 'rb') as f:
        file_bytes = f.read()
    input_hash = hashlib.sha256(file_bytes).hexdigest()
    
    im = tifffile.imread(s1_tif_path)
    if im.ndim != 3 or im.shape[0] < 2 or im.shape[1] != 512 or im.shape[2] != 512:
        raise ValueError(f"GeoTIFF must have shape (2, 512, 512) for [VV, VH] channels. Got {im.shape}.")
    
    s1_data = im[:2, :, :].astype(np.float32)
    geo = parse_geotiff_metadata(s1_tif_path)
    
    # 2. Strict Validity Masking
    valid_mask = compute_valid_mask(s1_data[0], s1_data[1])
    valid_count = int(valid_mask.sum())
    valid_coverage_pct = round(float((valid_count / (512 * 512)) * 100.0), 2)
    if valid_coverage_pct < 10.0:
        raise ValueError(f"Scene has insufficient valid SAR coverage ({valid_coverage_pct}%).")
        
    pixel_area_m2 = compute_geodetic_pixel_area(geo['center_lat'], geo['res_deg_x'], geo['res_deg_y'])
    ha_per_px = pixel_area_m2 / 10000.0
    
    # 3. Feature Extraction
    t_feat_start = time.time()
    X, vv, vh = extract_features(s1_data, valid_mask)
    timings['feature_extraction_ms'] = round((time.time() - t_feat_start) * 1000.0, 2)
    
    # 4. Model Prediction
    t_model_start = time.time()
    model = joblib.load(MODEL_PATH)
    preds = model.predict(X)
    timings['model_prediction_ms'] = round((time.time() - t_model_start) * 1000.0, 2)
    
    # Strict exclusion of invalid pixels from all predictions
    pred_water = (preds.reshape(512, 512) == 1) & valid_mask
    fixed_water = (vv < -16.0) & (vh < -23.0) & valid_mask
    disagreement = (pred_water != fixed_water) & valid_mask
    
    # 5. Permanent Water Handling with Strict Geometric Alignment Validation
    perm_water = np.zeros((512, 512), dtype=bool)
    has_perm_baseline = False
    jrc_path_to_check = None

    if jrc_tif_path and os.path.exists(jrc_tif_path):
        jrc_path_to_check = jrc_tif_path
    else:
        # Check if parallel JRC exists in raw dir
        base_name = os.path.basename(s1_tif_path).replace('_S1Hand.tif', '_JRCWaterHand.tif')
        candidate_jrc = os.path.join(os.path.dirname(s1_tif_path), '..', 'JRCWaterHand', base_name)
        if os.path.exists(candidate_jrc):
            jrc_path_to_check = candidate_jrc

    if jrc_path_to_check:
        try:
            # Geometrically validate JRC raster against S1 scene
            jrc_geo = parse_geotiff_metadata(jrc_path_to_check)
            with tifffile.TiffFile(jrc_path_to_check) as jrc_tif:
                jrc_shape = jrc_tif.pages[0].shape

            if jrc_shape != (512, 512):
                raise ValueError(f"JRC raster shape mismatch: expected (512, 512), got {jrc_shape}")

            # Verify CRS matches
            if jrc_geo['crs'] != geo['crs']:
                raise ValueError(f"JRC CRS mismatch: expected {geo['crs']}, got {jrc_geo['crs']}")

            # Strict Sub-Pixel Grid Alignment:
            # At res ~ 8.983e-5 deg (~10m), origin tolerance must be <= 0.05 pixel (~0.5m)
            # Accumulated resolution drift across 512 pixels must be <= 0.05 pixel total
            # max_res_delta = (0.05 * res_x) / 512 ≈ 8.77e-9 deg
            max_origin_tol_deg = 0.05 * min(geo['res_deg_x'], geo['res_deg_y'])
            max_res_tol_deg = (0.05 * min(geo['res_deg_x'], geo['res_deg_y'])) / 512.0

            delta_res_x = abs(jrc_geo['res_deg_x'] - geo['res_deg_x'])
            delta_res_y = abs(jrc_geo['res_deg_y'] - geo['res_deg_y'])
            if delta_res_x > max_res_tol_deg or delta_res_y > max_res_tol_deg:
                raise ValueError(
                    f"JRC pixel resolution mismatch: S1=({geo['res_deg_x']:.10f}, {geo['res_deg_y']:.10f}), "
                    f"JRC=({jrc_geo['res_deg_x']:.10f}, {jrc_geo['res_deg_y']:.10f}), "
                    f"accumulated displacement across 512px exceeds 0.05 pixels ({max_res_tol_deg:.2e} deg limit)."
                )

            delta_origin_x = abs(jrc_geo['origin_lon'] - geo['origin_lon'])
            delta_origin_y = abs(jrc_geo['origin_lat'] - geo['origin_lat'])
            if delta_origin_x > max_origin_tol_deg or delta_origin_y > max_origin_tol_deg:
                raise ValueError(
                    f"JRC spatial origin mismatch: S1=({geo['origin_lon']:.6f}, {geo['origin_lat']:.6f}), "
                    f"JRC=({jrc_geo['origin_lon']:.6f}, {jrc_geo['origin_lat']:.6f}), "
                    f"origin offset exceeds 0.05 pixels ({max_origin_tol_deg:.2e} deg limit)."
                )

            jrc_im = tifffile.imread(jrc_path_to_check)
            perm_water = (jrc_im > 0) & valid_mask
            has_perm_baseline = True
            baseline_status = "JRC Global Permanent Water baseline verified and applied."
        except Exception as jrc_err:
            has_perm_baseline = False
            baseline_status = f"Permanent water baseline rejected due to geometric misalignment: {str(jrc_err)}"
    else:
        baseline_status = "Surface-water detection only; permanent-water baseline unavailable."

    if has_perm_baseline:
        cand_water = pred_water & (~perm_water)
        water_metric_name = "candidate_flood_water"
        water_label = "Candidate Flood Water"
        p1_cat = "Priority 1: Large candidate flood-water area"
        p2_cat = "Priority 2: Moderate candidate flood-water area"
    else:
        cand_water = pred_water
        water_metric_name = "detected_surface_water"
        water_label = "Detected Surface Water"
        p1_cat = "Priority 1: Large detected surface-water area"
        p2_cat = "Priority 2: Moderate detected surface-water area"

    total_cand_water_ha = round(float(cand_water.sum() * ha_per_px), 2)
    total_perm_water_ha = round(float(perm_water.sum() * ha_per_px), 2)
    total_disagree_ha = round(float(disagreement.sum() * ha_per_px), 2)
    
    # 6. Sectorization (8x8 = 64 sectors)
    sectors = []
    sec_size = 64
    for r_idx in range(8):
        for c_idx in range(8):
            r0, r1 = r_idx * sec_size, (r_idx + 1) * sec_size
            c0, c1 = c_idx * sec_size, (c_idx + 1) * sec_size
            
            s_val = int(valid_mask[r0:r1, c0:c1].sum())
            s_cand = int(cand_water[r0:r1, c0:c1].sum())
            s_perm = int(perm_water[r0:r1, c0:c1].sum())
            s_dis = int(disagreement[r0:r1, c0:c1].sum())
            
            s_val_ha = round(float(s_val * ha_per_px), 2)
            s_cand_ha = round(float(s_cand * ha_per_px), 2)
            s_perm_ha = round(float(s_perm * ha_per_px), 2)
            s_dis_ha = round(float(s_dis * ha_per_px), 2)
            
            # Enforce invariant strictly
            if s_cand > s_val or s_cand_ha > s_val_ha:
                raise ValueError(f"Sector ({r_idx},{c_idx}) invariant failed: water extent exceeds valid area.")

            if s_cand_ha > 15.0:
                cat = p1_cat
            elif s_cand_ha > 5.0:
                cat = p2_cat
            else:
                cat = "Priority 3: Minor / Dry"
                
            sec_id = f"SEC_{(r_idx * 8) + c_idx + 1}"
            sectors.append({
                'id': sec_id,
                'r': r0,
                'c': c0,
                'valid_ha': s_val_ha,
                'candidate_water_ha': s_cand_ha,
                'permanent_water_ha': s_perm_ha,
                'disagreement_ha': s_dis_ha,
                'disagreement_alert': "High Disagreement" if s_dis_ha > 4.0 else "Agreement",
                'triage_category': cat
            })
            
    sectors.sort(key=lambda s: s['candidate_water_ha'], reverse=True)
    for idx, s in enumerate(sectors):
        s['rank'] = idx + 1
        
    # 7. Render True Transparent RGBA PNG Rasters
    t_render_start = time.time()
    
    # SAR False color (RGB with solid alpha)
    vv_norm = np.clip((vv - (-25.0)) / (0.0 - (-25.0)), 0, 1)
    vh_norm = np.clip((vh - (-32.0)) / (-5.0 - (-32.0)), 0, 1)
    diff_norm = np.clip(((vv - vh) - 0.0) / (15.0 - 0.0), 0, 1)
    sar_rgba = np.zeros((512, 512, 4), dtype=np.float32)
    sar_rgba[:, :, 0] = vv_norm
    sar_rgba[:, :, 1] = vh_norm
    sar_rgba[:, :, 2] = diff_norm
    sar_rgba[:, :, 3] = np.where(valid_mask, 1.0, 0.0)
    
    # Candidate Water Mask: Transparent RGBA (Crimson [0.88, 0.11, 0.28, 0.85] for candidate flood water ONLY)
    cand_rgba = np.zeros((512, 512, 4), dtype=np.float32)
    cand_rgba[cand_water] = [0.88, 0.11, 0.28, 0.85]
    
    # Permanent Water Mask: Transparent RGBA (Cyan [0.08, 0.52, 0.78, 0.85] for permanent baseline ONLY)
    perm_rgba = np.zeros((512, 512, 4), dtype=np.float32)
    perm_rgba[perm_water] = [0.08, 0.52, 0.78, 0.85]

    # Disagreement Mask: Amber [0.85, 0.47, 0.02, 0.80] where models disagree
    dis_rgba = np.zeros((512, 512, 4), dtype=np.float32)
    dis_rgba[disagreement] = [0.85, 0.47, 0.02, 0.80]
    
    img_sar_b64 = rgba_to_b64(sar_rgba)
    img_cand_water_b64 = rgba_to_b64(cand_rgba)
    img_perm_water_b64 = rgba_to_b64(perm_rgba)
    img_disagreement_b64 = rgba_to_b64(dis_rgba)
    timings['rendering_ms'] = round((time.time() - t_render_start) * 1000.0, 2)
    
    timings['total_pipeline_ms'] = round((time.time() - t0) * 1000.0, 2)
    
    title = scene_name or f"SAR Scene ({geo['center_lat']}°N, {geo['center_lon']}°E)"
    
    return {
        'status': 'completed',
        'input_hash': input_hash,
        'model_version': 'xgboost_sar_flood_v1.2',
        'baseline_status': baseline_status,
        'timings': timings,
        'metadata': {
            'id': f"SCENE_{input_hash[:8]}",
            'name': title,
            'region': f"Coordinates ({geo['center_lat']}°N, {geo['center_lon']}°E)",
            'date': "Sentinel-1 Acquisition (Historical)",
            'sensor': "Sentinel-1 C-band SAR GRD",
            'lat': geo['center_lat'],
            'lon': geo['center_lon'],
            'crs': geo['crs'],
            'origin_lon': geo['origin_lon'],
            'origin_lat': geo['origin_lat'],
            'res_deg_x': geo['res_deg_x'],
            'res_deg_y': geo['res_deg_y']
        },
        'geodesy': {
            'pixel_area_m2': round(pixel_area_m2, 2),
            'max_sector_ha': round(float(64 * 64 * ha_per_px), 2),
            'footprint_km2': round(float(512 * 512 * pixel_area_m2 / 1e6), 2)
        },
        'has_permanent_baseline': has_perm_baseline,
        'water_label': water_label,
        'valid_coverage_pct': valid_coverage_pct,
        'total_candidate_water_ha': total_cand_water_ha,
        'total_permanent_water_ha': total_perm_water_ha,
        'total_disagreement_ha': total_disagree_ha,
        'img_sar_b64': img_sar_b64,
        'img_cand_water_b64': img_cand_water_b64,
        'img_perm_water_b64': img_perm_water_b64,
        'img_disagreement_b64': img_disagreement_b64,
        'sectors': sectors
    }
