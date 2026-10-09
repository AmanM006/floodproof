"""
Reconciliation Analysis for FloodProof: Direct Confusion Matrix Aggregation.

Computes exact TP, FP, FN, TN directly from chip arrays:
1. Re-evaluates each chip to record exact TP, FP, FN, TN integer pixel counts.
2. Compares Pooled-Pixel vs Mean-per-Chip metrics.
3. Separates:
   - Validation (Sri Lanka, 9 chips)
   - Test Event (India - All 18 chips)
   - Test Event (India - 17 Untouched chips, excluding India_900498 diagnostic chip)
   - Test Event (Paraguay - 12 chips)
4. Saves full breakdown to `reports/reconciliation_benchmarks.csv`.
"""

import os
import pandas as pd
import numpy as np
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

def main():
    os.makedirs(REPORTS_DIR, exist_ok=True)
    df = pd.read_csv(MANIFEST_PATH)
    xgb_model = joblib.load(os.path.join(ARTIFACTS_DIR, 'xgboost_sar_flood.joblib'))
    unet_model = CompactUNet(2, 1)
    unet_model.load_state_dict(torch.load(os.path.join(ARTIFACTS_DIR, 'compact_unet.pt'), map_location='cpu'))
    unet_model.eval()

    eval_splits = ['val', 'test_india', 'test_paraguay']
    chip_records = []

    for _, row in df.iterrows():
        if row['split'] not in eval_splits:
            continue
        chip_id = row['chip_id']
        split = row['split']
        country = row['country']

        s1 = tifffile.imread(row['s1_file'])
        lbl = tifffile.imread(row['lbl_file'])

        valid_mask = (lbl >= 0)
        valid_px = int(valid_mask.sum())
        if valid_px == 0:
            continue

        vv = np.nan_to_num(s1[0], nan=-30.0)
        vh = np.nan_to_num(s1[1], nan=-35.0)

        # Models
        pred_fixed = ((vv < -16.0) & (vh < -23.0)).astype(int)
        t_otsu = compute_otsu_threshold(vh[valid_mask])
        pred_otsu = (vh < t_otsu).astype(int)

        feats = extract_chip_features(s1)
        H, W, C = feats.shape
        prob_xgb = xgb_model.predict_proba(feats.reshape(-1, C))[:, 1].reshape(H, W)
        pred_xgb = (prob_xgb > 0.5).astype(int)

        vv_norm = (np.clip(vv, -35.0, 5.0) - (-15.0)) / 10.0
        vh_norm = (np.clip(vh, -35.0, 5.0) - (-22.0)) / 10.0
        x_tensor = torch.tensor(np.stack([vv_norm, vh_norm], axis=0).astype(np.float32)).unsqueeze(0)
        with torch.no_grad():
            prob_unet = torch.sigmoid(unet_model(x_tensor)).squeeze().numpy()
        pred_unet = (prob_unet > 0.5).astype(int)

        yt = lbl[valid_mask]

        models_dict = {
            'Fixed SAR Threshold': pred_fixed,
            'Adaptive Otsu Threshold': pred_otsu,
            'XGBoost SAR Classifier': pred_xgb,
            'Compact U-Net (PyTorch)': pred_unet
        }

        for m_name, p_arr in models_dict.items():
            yp = p_arr[valid_mask]
            tp = int(np.sum((yt == 1) & (yp == 1)))
            fp = int(np.sum((yt == 0) & (yp == 1)))
            fn = int(np.sum((yt == 1) & (yp == 0)))
            tn = int(np.sum((yt == 0) & (yp == 0)))

            iou = tp / (tp + fp + fn) if (tp + fp + fn) > 0 else 0.0
            prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
            rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
            f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0
            acc = (tp + tn) / valid_px

            chip_records.append({
                'chip_id': chip_id,
                'country': country,
                'split': split,
                'model': m_name,
                'valid_pixels': valid_px,
                'water_pixels': int(np.sum(yt == 1)),
                'tp': tp,
                'fp': fp,
                'fn': fn,
                'tn': tn,
                'chip_iou': iou,
                'chip_prec': prec,
                'chip_rec': rec,
                'chip_f1': f1,
                'chip_acc': acc
            })

    raw_chips_df = pd.DataFrame(chip_records)

    # Build reconciliation table
    splits_to_compare = [
        ('Validation (Sri Lanka)', raw_chips_df[raw_chips_df['split'] == 'val']),
        ('Test Event (India - All 18 chips)', raw_chips_df[raw_chips_df['split'] == 'test_india']),
        ('Test Event (India - 17 Untouched chips, excl. India_900498)', raw_chips_df[(raw_chips_df['split'] == 'test_india') & (raw_chips_df['chip_id'] != 'India_900498')]),
        ('Test Event (Paraguay - 12 chips)', raw_chips_df[raw_chips_df['split'] == 'test_paraguay'])
    ]

    reconciled = []
    for split_label, sub in splits_to_compare:
        for model in ['Fixed SAR Threshold', 'Adaptive Otsu Threshold', 'XGBoost SAR Classifier', 'Compact U-Net (PyTorch)']:
            m_sub = sub[sub['model'] == model]
            n_chips = len(m_sub)
            if n_chips == 0:
                continue

            sum_tp = m_sub['tp'].sum()
            sum_fp = m_sub['fp'].sum()
            sum_fn = m_sub['fn'].sum()
            sum_tn = m_sub['tn'].sum()
            sum_valid = m_sub['valid_pixels'].sum()
            sum_water = m_sub['water_pixels'].sum()

            pooled_union = sum_tp + sum_fp + sum_fn
            pooled_iou = sum_tp / pooled_union if pooled_union > 0 else 0.0
            pooled_prec = sum_tp / (sum_tp + sum_fp) if (sum_tp + sum_fp) > 0 else 0.0
            pooled_rec = sum_tp / (sum_tp + sum_fn) if (sum_tp + sum_fn) > 0 else 0.0
            pooled_f1 = 2 * pooled_prec * pooled_rec / (pooled_prec + pooled_rec) if (pooled_prec + pooled_rec) > 0 else 0.0
            pooled_acc = (sum_tp + sum_tn) / sum_valid if sum_valid > 0 else 0.0

            reconciled.append({
                'split': split_label,
                'model': model,
                'chips': n_chips,
                'valid_pixels': int(sum_valid),
                'water_pixels': int(sum_water),
                'pooled_tp': int(sum_tp),
                'pooled_fp': int(sum_fp),
                'pooled_fn': int(sum_fn),
                'pooled_iou': round(float(pooled_iou), 4),
                'mean_per_chip_iou': round(float(m_sub['chip_iou'].mean()), 4),
                'pooled_precision': round(float(pooled_prec), 4),
                'mean_per_chip_precision': round(float(m_sub['chip_prec'].mean()), 4),
                'pooled_recall': round(float(pooled_rec), 4),
                'mean_per_chip_recall': round(float(m_sub['chip_rec'].mean()), 4),
                'pooled_f1': round(float(pooled_f1), 4),
                'mean_per_chip_f1': round(float(m_sub['chip_f1'].mean()), 4),
                'pooled_accuracy': round(float(pooled_acc), 4)
            })

    out_df = pd.DataFrame(reconciled)
    out_path = os.path.join(REPORTS_DIR, 'reconciliation_benchmarks.csv')
    out_df.to_csv(out_path, index=False)
    print(f"Reconciliation table saved to: {out_path}")

    # Print summary
    cols = ['split', 'model', 'pooled_iou', 'mean_per_chip_iou', 'pooled_precision', 'mean_per_chip_precision', 'pooled_recall', 'mean_per_chip_recall', 'pooled_accuracy']
    print("\n================ RECONCILED BENCHMARK COMPARISON ================")
    print(out_df[cols].to_string(index=False))

if __name__ == '__main__':
    main()
