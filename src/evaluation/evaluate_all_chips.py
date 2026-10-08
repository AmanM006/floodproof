"""
Comprehensive Per-Chip Water and Candidate-Flood Evaluation for FloodProof.

Implements all required metric corrections:
1. Renames metrics to Water IoU / Water F1 (reflecting Sen1Floods11 HandLabeled ground-truth semantics).
2. Incorporates JRC Permanent Water overlay:
   - Evaluates Candidate-Flood Water (Observed Water outside JRC Permanent baseline).
3. Produces per-chip breakdowns for:
   - Fixed SAR Threshold (VV < -16 dB, VH < -23 dB)
   - Adaptive Otsu Threshold
   - XGBoost Classifier
   - Compact U-Net
4. Computes equal-weight event averages for both India and Paraguay.
5. Saves per-chip metrics to `reports/per_chip_metrics.csv` and updated summary to `reports/benchmark.csv`.
"""

import os
import time
import numpy as np
import pandas as pd
import tifffile
import joblib
from scipy.ndimage import uniform_filter
import torch

from src.models.train_unet import CompactUNet

MANIFEST_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'manifests', 'downloaded_chips.csv')
ARTIFACTS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'artifacts')
REPORTS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'reports')

def compute_otsu_threshold(img_valid):
    if len(img_valid) == 0:
        return -20.0
    hist, bin_edges = np.histogram(img_valid, bins=100)
    bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2.0
    hist = hist.astype(float)
    total = hist.sum()
    if total == 0:
        return -20.0
    current_max = 0
    threshold = bin_centers[0]
    weight_background = 0.0
    sum_background = 0.0
    total_mean = np.dot(bin_centers, hist) / total
    for i in range(len(hist)):
        weight_background += hist[i]
        if weight_background == 0:
            continue
        weight_foreground = total - weight_background
        if weight_foreground == 0:
            break
        sum_background += bin_centers[i] * hist[i]
        mean_background = sum_background / weight_background
        mean_foreground = (total_mean * total - sum_background) / weight_foreground
        var_between = weight_background * weight_foreground * (mean_background - mean_foreground) ** 2
        if var_between > current_max:
            current_max = var_between
            threshold = bin_centers[i]
    return threshold

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

def calc_binary_metrics(yt, yp):
    if len(yt) == 0:
        return 0.0, 0.0, 0.0, 0.0
    inter = np.sum((yt == 1) & (yp == 1))
    union = np.sum((yt == 1) | (yp == 1))
    tp = inter
    fp = np.sum((yt == 0) & (yp == 1))
    fn = np.sum((yt == 1) & (yp == 0))
    tn = np.sum((yt == 0) & (yp == 0))

    iou = float(inter / union) if union > 0 else 0.0
    prec = float(tp / (tp + fp)) if (tp + fp) > 0 else 0.0
    rec = float(tp / (tp + fn)) if (tp + fn) > 0 else 0.0
    f1 = float(2 * prec * rec / (prec + rec)) if (prec + rec) > 0 else 0.0
    acc = float((tp + tn) / (len(yt))) if len(yt) > 0 else 0.0
    return iou, prec, rec, f1, acc

def run_evaluation():
    os.makedirs(REPORTS_DIR, exist_ok=True)
    df = pd.read_csv(MANIFEST_PATH)

    xgb_model = joblib.load(os.path.join(ARTIFACTS_DIR, 'xgboost_sar_flood.joblib'))
    unet_model = CompactUNet(2, 1)
    unet_model.load_state_dict(torch.load(os.path.join(ARTIFACTS_DIR, 'compact_unet.pt'), map_location='cpu'))
    unet_model.eval()

    per_chip_rows = []

    for idx, row in df.iterrows():
        chip_id = row['chip_id']
        split = row['split']
        country = row['country']

        s1 = tifffile.imread(row['s1_file'])
        lbl = tifffile.imread(row['lbl_file'])
        jrc = tifffile.imread(row['jrc_file']) if row['jrc_file'] and os.path.exists(row['jrc_file']) else np.zeros_like(lbl)

        valid_mask = (lbl >= 0)
        valid_px_count = int(valid_mask.sum())
        if valid_px_count == 0:
            continue

        vv = np.nan_to_num(s1[0], nan=-30.0)
        vh = np.nan_to_num(s1[1], nan=-35.0)

        # 1. Fixed Threshold
        pred_fixed = ((vv < -16.0) & (vh < -23.0)).astype(int)

        # 2. Otsu
        t_otsu = compute_otsu_threshold(vh[valid_mask])
        pred_otsu = (vh < t_otsu).astype(int)

        # 3. XGBoost
        feats = extract_chip_features(s1)
        H, W, C = feats.shape
        prob_xgb = xgb_model.predict_proba(feats.reshape(-1, C))[:, 1].reshape(H, W)
        pred_xgb = (prob_xgb > 0.5).astype(int)

        # 4. UNet
        vv_norm = (np.clip(vv, -35.0, 5.0) - (-15.0)) / 10.0
        vh_norm = (np.clip(vh, -35.0, 5.0) - (-22.0)) / 10.0
        x_tensor = torch.tensor(np.stack([vv_norm, vh_norm], axis=0).astype(np.float32)).unsqueeze(0)
        with torch.no_grad():
            prob_unet = torch.sigmoid(unet_model(x_tensor)).squeeze().numpy()
        pred_unet = (prob_unet > 0.5).astype(int)

        yt = lbl[valid_mask]

        # Candidate flood mask (excluding permanent water baseline)
        perm_mask = (jrc == 1) & valid_mask
        non_perm_valid = valid_mask & (~perm_mask)
        yt_candidate_flood = lbl[non_perm_valid]

        models_dict = {
            'Fixed SAR Threshold': pred_fixed,
            'Adaptive Otsu Threshold': pred_otsu,
            'XGBoost SAR Classifier': pred_xgb,
            'Compact U-Net (PyTorch)': pred_unet
        }

        for m_name, p_arr in models_dict.items():
            yp = p_arr[valid_mask]
            w_iou, w_prec, w_rec, w_f1, w_acc = calc_binary_metrics(yt, yp)

            # Candidate flood metrics (outside permanent water)
            if non_perm_valid.sum() > 0:
                yp_cf = p_arr[non_perm_valid]
                cf_iou, cf_prec, cf_rec, cf_f1, _ = calc_binary_metrics(yt_candidate_flood, yp_cf)
            else:
                cf_iou, cf_prec, cf_rec, cf_f1 = 0.0, 0.0, 0.0, 0.0

            per_chip_rows.append({
                'chip_id': chip_id,
                'country': country,
                'split': split,
                'model': m_name,
                'valid_pixels': valid_px_count,
                'water_pixels_true': int((yt == 1).sum()),
                'permanent_water_pixels': int(perm_mask.sum()),
                'candidate_flood_pixels_true': int((yt_candidate_flood == 1).sum()),
                'water_iou': round(w_iou, 4),
                'water_precision': round(w_prec, 4),
                'water_recall': round(w_rec, 4),
                'water_f1': round(w_f1, 4),
                'pixel_accuracy': round(w_acc, 4),
                'candidate_flood_iou': round(cf_iou, 4),
                'candidate_flood_f1': round(cf_f1, 4)
            })

    per_chip_df = pd.DataFrame(per_chip_rows)
    per_chip_csv = os.path.join(REPORTS_DIR, 'per_chip_metrics.csv')
    per_chip_df.to_csv(per_chip_csv, index=False)
    print(f"Saved per-chip evaluation to: {per_chip_csv}")

    # Summary table across evaluation sets
    summary_rows = []
    eval_splits = ['val', 'test_india', 'test_paraguay']

    for split in eval_splits:
        split_name = {
            'val': 'Validation (Sri Lanka)',
            'test_india': 'Test Event (India Monsoon)',
            'test_paraguay': 'Test Event (Paraguay)'
        }[split]

        sub = per_chip_df[per_chip_df['split'] == split]
        for m_name in ['Fixed SAR Threshold', 'Adaptive Otsu Threshold', 'XGBoost SAR Classifier', 'Compact U-Net (PyTorch)']:
            m_sub = sub[sub['model'] == m_name]
            summary_rows.append({
                'evaluation_set': split_name,
                'model': m_name,
                'water_iou': round(float(m_sub['water_iou'].mean()), 4),
                'water_precision': round(float(m_sub['water_precision'].mean()), 4),
                'water_recall': round(float(m_sub['water_recall'].mean()), 4),
                'water_f1': round(float(m_sub['water_f1'].mean()), 4),
                'candidate_flood_iou': round(float(m_sub['candidate_flood_iou'].mean()), 4),
                'candidate_flood_f1': round(float(m_sub['candidate_flood_f1'].mean()), 4),
                'pixel_accuracy': round(float(m_sub['pixel_accuracy'].mean()), 4),
                'chips_count': len(m_sub)
            })

    # Add Equal-Weight Unseen Event Average (India + Paraguay)
    for m_name in ['Fixed SAR Threshold', 'Adaptive Otsu Threshold', 'XGBoost SAR Classifier', 'Compact U-Net (PyTorch)']:
        ind_row = [r for r in summary_rows if r['evaluation_set'] == 'Test Event (India Monsoon)' and r['model'] == m_name][0]
        py_row = [r for r in summary_rows if r['evaluation_set'] == 'Test Event (Paraguay)' and r['model'] == m_name][0]

        summary_rows.append({
            'evaluation_set': 'Equal-Weight Test Average (India + Paraguay)',
            'model': m_name,
            'water_iou': round((ind_row['water_iou'] + py_row['water_iou']) / 2.0, 4),
            'water_precision': round((ind_row['water_precision'] + py_row['water_precision']) / 2.0, 4),
            'water_recall': round((ind_row['water_recall'] + py_row['water_recall']) / 2.0, 4),
            'water_f1': round((ind_row['water_f1'] + py_row['water_f1']) / 2.0, 4),
            'candidate_flood_iou': round((ind_row['candidate_flood_iou'] + py_row['candidate_flood_iou']) / 2.0, 4),
            'candidate_flood_f1': round((ind_row['candidate_flood_f1'] + py_row['candidate_flood_f1']) / 2.0, 4),
            'pixel_accuracy': round((ind_row['pixel_accuracy'] + py_row['pixel_accuracy']) / 2.0, 4),
            'chips_count': ind_row['chips_count'] + py_row['chips_count']
        })

    summary_df = pd.DataFrame(summary_rows)
    bench_csv = os.path.join(REPORTS_DIR, 'benchmark.csv')
    summary_df.to_csv(bench_csv, index=False)
    print("\n================ REVISED WATER & FLOOD-PROXY BENCHMARK ================")
    print(summary_df.to_string(index=False))

if __name__ == '__main__':
    run_evaluation()
