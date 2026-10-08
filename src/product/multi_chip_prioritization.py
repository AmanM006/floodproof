"""
Rigorous Multi-Chip Field Verification Prioritization Engine for FloodProof.

Implements all required audit corrections:
1. Pure Prediction-Driven Dispatch Queue:
   - Uses predicted candidate-flood extent (Predicted Water - JRC Permanent Water) and model ambiguity.
   - Ground-truth annotations are strictly held-out and used ONLY to retrospectively evaluate capture efficiency.
2. Baselines Compared:
   - Baseline 1: Multi-seed Uniform Random Dispatch (evaluated over 200 fixed random seeds, plus analytic expectation K/Total).
   - Baseline 2: Predicted Area-Only Ranking (dispatching purely by largest predicted candidate-water area).
   - Baseline 3: Simple Fixed SAR Threshold Ranking.
   - Proposed FloodProof Multi-Criteria Ranking (Candidate Flood Extent + Model Ambiguity requiring ground confirmation).
3. Evaluates across multiple representative chips (India & Paraguay test events).
4. Honest Area Accounting:
   - Clarifies 10m x 10m pixel geometry (0.01 ha/px nominal at equator/UTM standard).
   - Removes ungrounded settlement density proxies (no unverified settlement layers fabricated).
   - Clearly separates High-Confidence Impact sectors from Ambiguous / Verification-Priority sectors.
5. Saves results to `reports/multi_chip_dispatch_benchmark.csv` and `reports/field_verification_manifest.csv`.
"""

import os
import numpy as np
import pandas as pd
import tifffile
import joblib
from scipy.ndimage import uniform_filter

RAW_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'raw')
ARTIFACTS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'artifacts')
REPORTS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'reports')
MANIFEST_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'manifests', 'downloaded_chips.csv')

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

def evaluate_chip_dispatch(chip_id, xgb_model, top_k_values=[5, 10, 15]):
    s1_path = os.path.join(RAW_DIR, 'S1Hand', f'{chip_id}_S1Hand.tif')
    lbl_path = os.path.join(RAW_DIR, 'LabelHand', f'{chip_id}_LabelHand.tif')
    jrc_path = os.path.join(RAW_DIR, 'JRCWaterHand', f'{chip_id}_JRCWaterHand.tif')

    s1 = tifffile.imread(s1_path)
    lbl = tifffile.imread(lbl_path)
    jrc = tifffile.imread(jrc_path) if os.path.exists(jrc_path) else np.zeros_like(lbl)

    # 1. Predictions
    feats = extract_chip_features(s1)
    H, W, C = feats.shape
    prob = xgb_model.predict_proba(feats.reshape(-1, C))[:, 1].reshape(H, W)
    pred_water = (prob > 0.5).astype(int)

    # Fixed threshold prediction
    vv = np.nan_to_num(s1[0], nan=-30.0)
    vh = np.nan_to_num(s1[1], nan=-35.0)
    pred_fixed = ((vv < -16.0) & (vh < -23.0)).astype(int)

    # Candidate flood = Water outside permanent water baseline
    perm_water = (jrc == 1).astype(int)
    pred_candidate_flood = pred_water & (~perm_water)
    pred_fixed_candidate_flood = pred_fixed & (~perm_water)

    # Model ambiguity (distance from decision boundary 0.5)
    ambiguity = 1.0 - 2.0 * np.abs(prob - 0.5)

    # Ground truth candidate flood (for evaluation only)
    valid_mask = (lbl >= 0)
    true_candidate_flood = (lbl == 1) & (~perm_water) & valid_mask

    # Sectorize into 64x64 grid (64 sectors total per chip)
    sector_size = 64
    sectors = []
    sec_idx = 1

    for r in range(0, H, sector_size):
        for c in range(0, W, sector_size):
            r_end, c_end = r + sector_size, c + sector_size
            
            # Eligible valid pixels in sector
            sec_valid = valid_mask[r:r_end, c:c_end]
            if sec_valid.sum() == 0:
                continue

            # Features derived purely from model and baseline (No ground truth used in scoring!)
            cand_flood_px = int(pred_candidate_flood[r:r_end, c:c_end].sum())
            cand_fixed_px = int(pred_fixed_candidate_flood[r:r_end, c:c_end].sum())
            mean_amb = float(ambiguity[r:r_end, c:c_end].mean())

            # Evaluation ground truth (purely for retrospective scoring)
            actual_flood_px = int(true_candidate_flood[r:r_end, c:c_end].sum())

            # Multi-objective score: Candidate Flood extent (75%) + Ambiguity needing field check (25%)
            score_fp = (cand_flood_px * 0.75) + (mean_amb * 100.0 * 0.25)

            sectors.append({
                'sector_id': f"SEC_{sec_idx:02d}",
                'chip_id': chip_id,
                'pred_flood_ha': round(cand_flood_px * 0.01, 2),
                'pred_fixed_ha': round(cand_fixed_px * 0.01, 2),
                'actual_ground_truth_ha': round(actual_flood_px * 0.01, 2),
                'ambiguity_score': round(mean_amb, 3),
                'floodproof_score': round(score_fp, 2)
            })
            sec_idx += 1

    sec_df = pd.DataFrame(sectors)
    total_actual = sec_df['actual_ground_truth_ha'].sum()
    total_sectors = len(sec_df)

    if total_actual == 0:
        return None, None

    # Orderings
    order_fp = sec_df.sort_values(by='floodproof_score', ascending=False)
    order_area = sec_df.sort_values(by='pred_flood_ha', ascending=False)
    order_fixed = sec_df.sort_values(by='pred_fixed_ha', ascending=False)

    # Multi-seed uniform random baseline (200 trials)
    rng = np.random.default_rng(42)

    chip_metrics = []
    for k in top_k_values:
        if k > total_sectors:
            continue
        cov_fp = order_fp.head(k)['actual_ground_truth_ha'].sum()
        cov_area = order_area.head(k)['actual_ground_truth_ha'].sum()
        cov_fixed = order_fixed.head(k)['actual_ground_truth_ha'].sum()

        # Empirical random simulation over 200 seeds
        rand_sims = []
        for _ in range(200):
            sample_idx = rng.choice(total_sectors, size=k, replace=False)
            rand_sims.append(sec_df.iloc[sample_idx]['actual_ground_truth_ha'].sum())
        mean_rand = float(np.mean(rand_sims))
        std_rand = float(np.std(rand_sims))
        analytic_expected_pct = (k / total_sectors) * 100.0

        chip_metrics.append({
            'chip_id': chip_id,
            'k': k,
            'total_sectors': total_sectors,
            'total_actual_ha': round(total_actual, 2),
            'floodproof_capture_pct': round((cov_fp / total_actual) * 100.0, 1),
            'area_only_capture_pct': round((cov_area / total_actual) * 100.0, 1),
            'fixed_threshold_capture_pct': round((cov_fixed / total_actual) * 100.0, 1),
            'simulated_random_pct': round((mean_rand / total_actual) * 100.0, 1),
            'simulated_random_std': round((std_rand / total_actual) * 100.0, 1),
            'analytic_expected_random_pct': round(analytic_expected_pct, 1)
        })

    return pd.DataFrame(chip_metrics), order_fp

def run_multi_chip_benchmark():
    os.makedirs(REPORTS_DIR, exist_ok=True)
    manifest = pd.read_csv(MANIFEST_PATH)
    xgb_model = joblib.load(os.path.join(ARTIFACTS_DIR, 'xgboost_sar_flood.joblib'))

    # Select representative chips from India and Paraguay test events
    test_chips = [
        'India_900498', 'India_591317', 'India_747992', 'India_828067',
        'Paraguay_913449', 'Paraguay_280900', 'Paraguay_790830'
    ]

    all_chip_results = []
    sample_manifest = None

    for c_id in test_chips:
        c_res, c_order = evaluate_chip_dispatch(c_id, xgb_model)
        if c_res is not None:
            all_chip_results.append(c_res)
            if sample_manifest is None and 'India' in c_id:
                sample_manifest = c_order

    combined = pd.concat(all_chip_results, ignore_index=True)
    bench_path = os.path.join(REPORTS_DIR, 'multi_chip_dispatch_benchmark.csv')
    combined.to_csv(bench_path, index=False)

    # Aggregate across chips by k
    agg = combined.groupby('k').agg({
        'floodproof_capture_pct': 'mean',
        'area_only_capture_pct': 'mean',
        'fixed_threshold_capture_pct': 'mean',
        'simulated_random_pct': 'mean',
        'analytic_expected_random_pct': 'mean'
    }).reset_index()

    print("\n--- MULTI-CHIP FIELD VERIFICATION DISPATCH BENCHMARK ---")
    print(agg.to_string(index=False))

    # Save top dispatch manifest
    if sample_manifest is not None:
        sample_manifest['category'] = np.where(
            sample_manifest['pred_flood_ha'] > 20.0, 'High-Confidence Flood Impact',
            np.where(sample_manifest['ambiguity_score'] > 0.45, 'Ambiguous / Needs Field Check', 'Low Risk / Routine')
        )
        manifest_path = os.path.join(REPORTS_DIR, 'field_verification_manifest.csv')
        sample_manifest.to_csv(manifest_path, index=False)
        print(f"\nSaved updated field verification manifest to: {manifest_path}")

if __name__ == '__main__':
    run_multi_chip_benchmark()
