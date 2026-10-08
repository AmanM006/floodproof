"""
Field Verification Prioritization Engine for FloodProof.

Translates model flood predictions into a decision-support list for disaster response operators:
- Divides each 5.12 km x 5.12 km scene into localized 64x64 pixel grid sectors (~640m x 640m field inspection zones).
- Computes multi-criteria prioritization score:
    1. Flooded Area Proxy: predicted flood extent in sector (hectares).
    2. Prediction Ambiguity / Uncertainty: mean entropy/ambiguity around 0.5 decision boundary (requires physical verification).
    3. Critical Infrastructure / Density indicator (proxied via high radar backscatter urban/settlement density).
- Ranks candidate zones for ground crew dispatch.
- Evaluates against:
    - Baseline 1: Area-only ranking.
    - Baseline 2: Random dispatch order.
- Generates JSON export and CSV decision logs for field teams.
"""

import os
import json
import numpy as np
import pandas as pd
import tifffile
import joblib
from scipy.ndimage import uniform_filter

RAW_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'raw')
ARTIFACTS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'artifacts')
REPORTS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'reports')

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

def run_field_prioritization(chip_id="India_900498"):
    os.makedirs(REPORTS_DIR, exist_ok=True)
    os.makedirs(ARTIFACTS_DIR, exist_ok=True)

    s1_path = os.path.join(RAW_DIR, 'S1Hand', f'{chip_id}_S1Hand.tif')
    lbl_path = os.path.join(RAW_DIR, 'LabelHand', f'{chip_id}_LabelHand.tif')

    s1 = tifffile.imread(s1_path)
    lbl = tifffile.imread(lbl_path)

    # Run inference
    xgb_model = joblib.load(os.path.join(ARTIFACTS_DIR, 'xgboost_sar_flood.joblib'))
    feats = extract_chip_features(s1)
    H, W, C = feats.shape
    prob = xgb_model.predict_proba(feats.reshape(-1, C))[:, 1].reshape(H, W)
    pred_flood = (prob > 0.5).astype(int)

    # Ambiguity score: highest when probability is close to 0.5 (model is uncertain)
    # Ambiguity = 1 - 2 * |prob - 0.5|
    ambiguity = 1.0 - 2.0 * np.abs(prob - 0.5)

    # Settlement / built-up proxy: high VV backscatter (> -8 dB in dry land areas)
    vv = s1[0]
    built_up_proxy = (vv > -8.0).astype(float)

    # Grid into 64x64 sectors (8x8 = 64 sectors per 512x512 chip)
    sector_size = 64
    sectors = []
    sec_id = 1

    for r in range(0, H, sector_size):
        for c in range(0, W, sector_size):
            r_end = r + sector_size
            c_end = c + sector_size

            sec_flood = pred_flood[r:r_end, c:c_end]
            sec_amb = ambiguity[r:r_end, c:c_end]
            sec_built = built_up_proxy[r:r_end, c:c_end]
            sec_lbl = lbl[r:r_end, c:c_end]

            # Area in hectares (each pixel is 10m x 10m = 100 m^2 = 0.01 hectares)
            flood_px = int(sec_flood.sum())
            flood_ha = round(flood_px * 0.01, 2)
            actual_flood_px = int((sec_lbl == 1).sum())
            actual_flood_ha = round(actual_flood_px * 0.01, 2)

            mean_amb = float(sec_amb.mean())
            built_px = int(sec_built.sum())

            # Multi-objective priority score
            # 60% Flood extent weight, 25% Settlement presence, 15% Model ambiguity requiring field confirmation
            score = (flood_px * 0.6) + (built_px * 0.25) + (mean_amb * 100.0 * 0.15)

            sectors.append({
                'sector_id': f"SEC_{sec_id:02d}",
                'chip_id': chip_id,
                'row_slice': f"{r}:{r_end}",
                'col_slice': f"{c}:{c_end}",
                'predicted_flood_ha': flood_ha,
                'actual_ground_truth_ha': actual_flood_ha,
                'built_up_pixels': built_px,
                'ambiguity_score': round(mean_amb, 3),
                'priority_score': round(score, 2),
                'operator_action': "Dispatch Priority 1" if score > 300 else ("Priority 2 (Monitor)" if score > 100 else "Low Risk / Deferred")
            })
            sec_id += 1

    sec_df = pd.DataFrame(sectors)

    # 1. FloodProof Multi-Criteria Ranking
    ranked_floodproof = sec_df.sort_values(by='priority_score', ascending=False).reset_index(drop=True)
    # 2. Baseline: Flood-area only ranking
    ranked_area_only = sec_df.sort_values(by='predicted_flood_ha', ascending=False).reset_index(drop=True)
    # 3. Baseline: Random order
    np.random.seed(42)
    ranked_random = sec_df.sample(frac=1.0, random_state=42).reset_index(drop=True)

    # Evaluate retrospective impact: How much actual flooded area is covered in top K sectors?
    top_k_list = [5, 10, 15]
    total_actual_flood = sec_df['actual_ground_truth_ha'].sum()
    print(f"\nTotal Actual Ground-Truth Flooded Area in Scene: {total_actual_flood:.2f} ha")

    eval_summary = []
    for k in top_k_list:
        cov_fp = ranked_floodproof.head(k)['actual_ground_truth_ha'].sum()
        cov_area = ranked_area_only.head(k)['actual_ground_truth_ha'].sum()
        cov_rand = ranked_random.head(k)['actual_ground_truth_ha'].sum()

        eval_summary.append({
            'top_k_sectors': k,
            'floodproof_coverage_ha': round(cov_fp, 2),
            'floodproof_capture_pct': round((cov_fp / total_actual_flood) * 100, 1) if total_actual_flood > 0 else 0,
            'area_only_capture_pct': round((cov_area / total_actual_flood) * 100, 1) if total_actual_flood > 0 else 0,
            'random_dispatch_capture_pct': round((cov_rand / total_actual_flood) * 100, 1) if total_actual_flood > 0 else 0
        })

    eval_df = pd.DataFrame(eval_summary)
    print("\n--- Field Verification Dispatch Efficiency ---")
    print(eval_df.to_string(index=False))

    # Export decision artifact
    ranked_path = os.path.join(REPORTS_DIR, 'field_verification_manifest.csv')
    ranked_floodproof.to_csv(ranked_path, index=False)
    eval_csv = os.path.join(REPORTS_DIR, 'dispatch_efficiency_benchmark.csv')
    eval_df.to_csv(eval_csv, index=False)

    print(f"\nTop 5 Priority Dispatch Sectors:")
    print(ranked_floodproof[['sector_id', 'predicted_flood_ha', 'built_up_pixels', 'priority_score', 'operator_action']].head(5).to_string(index=False))
    print(f"\nSaved field verification manifest to: {ranked_path}")

if __name__ == '__main__':
    run_field_prioritization()
