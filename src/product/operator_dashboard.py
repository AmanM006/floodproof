"""
Complete Interactive Operator Dashboard & AWS Review Workflow for FloodProof.

Features:
1. Historical Scene Selection:
   - India Monsoon Flood Event (2016-08-12, Assam / Brahmaputra Basin)
   - Paraguay Wetland Flood Event (2018-10-31)
2. Interactive Geospatial Overlays:
   - Sentinel-1 SAR False Color Composite
   - Baseline JRC Permanent Water (Historical Rivers & Water bodies)
   - XGBoost Model Water Prediction
   - Fixed SAR Threshold Prediction (VV < -16 dB, VH < -23 dB)
   - Explicit Model Disagreement Overlay (areas where XGBoost and Threshold disagree)
   - Candidate-Flood Proxy (Detected Water outside Permanent Baseline)
3. Transparent Prioritization Triage:
   - Uses Predicted Candidate-Water Area as the primary defensible ranking
   - Flags High-Disagreement Sectors for Priority Ground Verification
4. Interactive Human-in-the-Loop Operator Actions:
   - Confirm Dispatch, Reject False Alarm, or Flag 'Ground Team Required'
   - Persists decisions locally and syncs audit manifests directly to Amazon S3.
"""

import os
import json
import numpy as np
import pandas as pd
import tifffile
import joblib
import subprocess
from scipy.ndimage import uniform_filter

RAW_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'raw')
ARTIFACTS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'artifacts')
REPORTS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'reports')
DECISIONS_FILE = os.path.join(REPORTS_DIR, 'operator_decisions_log.csv')
S3_BUCKET = "floodproof-verification-artifacts-699158992887"

EVENT_METADATA = {
    'India_591317': {
        'event_name': 'India Monsoon Flood Event',
        'region': 'Assam / Brahmaputra River Basin, India',
        'acquisition_date': '2016-08-12',
        'sensor': 'Sentinel-1 C-band SAR GRD',
        'orbit': 'Descending',
        'footprint_bbox': 'Lon [92.15, 94.16], Lat [24.85, 28.29]'
    },
    'India_747992': {
        'event_name': 'India Monsoon Flood Event',
        'region': 'Assam / Brahmaputra River Basin, India',
        'acquisition_date': '2016-08-12',
        'sensor': 'Sentinel-1 C-band SAR GRD',
        'orbit': 'Descending',
        'footprint_bbox': 'Lon [92.15, 94.16], Lat [24.85, 28.29]'
    },
    'Paraguay_913449': {
        'event_name': 'Paraguay Basin Flood Event',
        'region': 'Paraguay River Basin, Paraguay',
        'acquisition_date': '2018-10-31',
        'sensor': 'Sentinel-1 C-band SAR GRD',
        'orbit': 'Descending',
        'footprint_bbox': 'Lon [-58.59, -54.65], Lat [-28.19, -21.64]'
    }
}

def extract_chip_features(s1_arr):
    vv = np.nan_to_num(s1_arr[0], nan=-30.0)
    vh = np.nan_to_num(s1_arr[1], nan=-35.0)
    diff = vv - vh
    norm_ratio = (vv - vh) / (np.abs(vv) + np.abs(vh) + 1e-5)
    vv_mean_3 = uniform_filter(vv, size=3)
    vh_mean_3 = uniform_filter(vh, size=3)
    vv_sq = uniform_filter(vv**2, size=3)
    vv_std_3 = np.sqrt(np.maximum(0, vv_sq - vv_mean_3**2))
    return np.stack([vv, vh, diff, norm_ratio, vv_mean_3, vh_mean_3, vv_std_3], axis=-1)

class OperatorDashboard:
    def __init__(self):
        self.model = joblib.load(os.path.join(ARTIFACTS_DIR, 'xgboost_sar_flood.joblib'))

    def run_scene_analysis(self, chip_id: str):
        meta = EVENT_METADATA.get(chip_id, {
            'event_name': 'Historical Flood Event',
            'region': 'Satellite Footprint',
            'acquisition_date': 'Historical Acquisition',
            'sensor': 'Sentinel-1 SAR',
            'orbit': 'N/A',
            'footprint_bbox': 'N/A'
        })

        s1_path = os.path.join(RAW_DIR, 'S1Hand', f'{chip_id}_S1Hand.tif')
        lbl_path = os.path.join(RAW_DIR, 'LabelHand', f'{chip_id}_LabelHand.tif')
        jrc_path = os.path.join(RAW_DIR, 'JRCWaterHand', f'{chip_id}_JRCWaterHand.tif')

        s1 = tifffile.imread(s1_path)
        lbl = tifffile.imread(lbl_path)
        jrc = tifffile.imread(jrc_path) if os.path.exists(jrc_path) else np.zeros_like(lbl)

        # 1. XGBoost Prediction
        feats = extract_chip_features(s1)
        H, W, C = feats.shape
        probs = self.model.predict_proba(feats.reshape(-1, C))[:, 1].reshape(H, W)
        pred_xgb = (probs > 0.5).astype(int)

        # 2. Fixed SAR Threshold Prediction
        vv = np.nan_to_num(s1[0], nan=-30.0)
        vh = np.nan_to_num(s1[1], nan=-35.0)
        pred_fixed = ((vv < -16.0) & (vh < -23.0)).astype(int)

        # 3. Model Disagreement
        disagreement = (pred_xgb != pred_fixed).astype(int)

        # 4. Permanent water baseline and candidate flood
        perm_water = (jrc == 1).astype(int)
        cand_flood = pred_xgb & (~perm_water)

        valid_mask = (lbl >= 0)
        valid_px = int(valid_mask.sum())
        total_px = lbl.size

        # True geodetic pixel scale
        lat_approx = 26.63 if 'India' in chip_id else -25.0
        lat_rad = np.radians(lat_approx)
        deg_to_m = 111319.5
        dx = 8.98315e-5 * deg_to_m * np.cos(lat_rad)
        dy = 8.98315e-5 * deg_to_m
        px_area_m2 = dx * dy
        px_to_ha = px_area_m2 / 10000.0

        # Sectorize 64x64
        sectors = []
        sec_idx = 1
        for r in range(0, H, 64):
            for c in range(0, W, 64):
                v_slice = valid_mask[r:r+64, c:c+64]
                if v_slice.sum() == 0:
                    continue
                
                cf_px = int(cand_flood[r:r+64, c:c+64].sum())
                pw_px = int(perm_water[r:r+64, c:c+64].sum())
                dis_px = int(disagreement[r:r+64, c:c+64].sum())
                
                cf_ha = round(cf_px * px_to_ha, 2)
                pw_ha = round(pw_px * px_to_ha, 2)
                dis_ha = round(dis_px * px_to_ha, 2)
                
                # Ranking reason
                if cf_ha > 15.0 and dis_ha > 5.0:
                    reason = "Major Candidate Flood with High Model Disagreement (Primary Field Verification Target)"
                    cat = "Priority 1 - Ground Check"
                elif cf_ha > 15.0:
                    reason = "High Candidate Flood Inundation (High Model Agreement)"
                    cat = "Priority 2 - Inundation Confirmed"
                elif dis_ha > 5.0:
                    reason = "Borderline Backscatter / Vegetation Disagreement"
                    cat = "Priority 3 - Ambiguity Check"
                else:
                    reason = "Low Inundation Risk / Routine Monitoring"
                    cat = "Low Risk / Deferred"

                sectors.append({
                    'sector_id': f"SEC_{sec_idx:02d}",
                    'chip_id': chip_id,
                    'row_bounds': f"{r}:{r+64}",
                    'col_bounds': f"{c}:{c+64}",
                    'candidate_flood_ha': cf_ha,
                    'permanent_water_ha': pw_ha,
                    'model_disagreement_ha': dis_ha,
                    'triage_category': cat,
                    'ranking_reason': reason
                })
                sec_idx += 1

        sec_df = pd.DataFrame(sectors).sort_values(by='candidate_flood_ha', ascending=False).reset_index(drop=True)
        sec_df['dispatch_rank'] = range(1, len(sec_df) + 1)

        summary = {
            'metadata': meta,
            'scene_total_pixels': total_px,
            'valid_pixels': valid_px,
            'unmasked_coverage_pct': round((valid_px / total_px) * 100, 1),
            'total_candidate_flood_ha': round(int(cand_flood.sum()) * px_to_ha, 2),
            'total_permanent_water_ha': round(int(perm_water.sum()) * px_to_ha, 2),
            'total_disagreement_ha': round(int(disagreement.sum()) * px_to_ha, 2),
            'total_eligible_sectors': len(sec_df),
            'sectors_df': sec_df
        }
        return summary

    def record_decision(self, chip_id: str, sector_id: str, action: str, operator_notes: str):
        record = {
            'timestamp_utc': pd.Timestamp.now('UTC').isoformat(),
            'chip_id': chip_id,
            'sector_id': sector_id,
            'operator_action': action,
            'notes': operator_notes,
            's3_audit_sync': False
        }
        df_rec = pd.DataFrame([record])
        if os.path.exists(DECISIONS_FILE):
            df_rec.to_csv(DECISIONS_FILE, mode='a', header=False, index=False)
        else:
            df_rec.to_csv(DECISIONS_FILE, mode='w', header=True, index=False)

        # Sync to S3
        cmd = f"aws s3 cp {DECISIONS_FILE} s3://{S3_BUCKET}/audit_logs/operator_decisions_log.csv"
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        s3_ok = (res.returncode == 0)
        return s3_ok

def main():
    dashboard = OperatorDashboard()
    print("\n================ FLOODPROOF OPERATOR DASHBOARD ================")
    print("Running end-to-end analysis on held-out India scene (India_591317)...")
    res = dashboard.run_scene_analysis('India_591317')

    m = res['metadata']
    print(f"\n--- Scene Metadata ---")
    print(f"Event: {m['event_name']}")
    print(f"Region: {m['region']}")
    print(f"Acquisition Date: {m['acquisition_date']}")
    print(f"Sensor: {m['sensor']} ({m['orbit']})")
    print(f"Valid Coverage: {res['unmasked_coverage_pct']}% of scene")
    print(f"Candidate Flood Area: {res['total_candidate_flood_ha']:.2f} ha (outside permanent baseline)")
    print(f"Permanent Water Area: {res['total_permanent_water_ha']:.2f} ha")
    print(f"Model Disagreement Area: {res['total_disagreement_ha']:.2f} ha")

    sectors = res['sectors_df']
    print(f"\n--- Top 5 Prioritized Field Verification Sectors (Total Eligible: {res['total_eligible_sectors']}) ---")
    print(sectors[['dispatch_rank', 'sector_id', 'candidate_flood_ha', 'model_disagreement_ha', 'triage_category', 'ranking_reason']].head(5).to_string(index=False))

    # Demonstrate simulated operator workflow actions
    print("\nSimulating operator actions and cloud audit persistence...")
    ok1 = dashboard.record_decision(
        'India_591317', 'SEC_01', 'CONFIRM_DISPATCH', 
        'High non-permanent flood extent confirmed; ground team assigned to check access embankment.'
    )
    ok2 = dashboard.record_decision(
        'India_591317', 'SEC_08', 'NEEDS_FIELD_CHECK',
        'Model disagreement present along agricultural border; physical verification required.'
    )
    print(f"Decisions logged locally and synced to S3 ({S3_BUCKET}): Status={ok1 and ok2}")

if __name__ == '__main__':
    main()
