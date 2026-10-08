"""
Visual Diagnostics with Permanent Water Overlay for FloodProof.

Generates a 5-panel diagnostic figure:
1. Sentinel-1 SAR False Color (VV, VH, VV-VH)
2. Hand-Labeled Ground Truth (Water vs Dry land, invalid masked)
3. JRC Permanent Water Baseline (Documented rivers/reservoirs)
4. Model Water Prediction (XGBoost)
5. Candidate Flood Water Overlay (Model Water outside Permanent Water baseline)

Saves figure to `reports/figures/flood_detection_comparison_india.png`.
"""

import os
import tifffile
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import joblib
from scipy.ndimage import uniform_filter

FIGURES_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'reports', 'figures')
ARTIFACTS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'artifacts')
RAW_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'raw')

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

def generate_visual_diagnostics():
    os.makedirs(FIGURES_DIR, exist_ok=True)
    sample_chip = "India_900498"
    s1_path = os.path.join(RAW_DIR, 'S1Hand', f'{sample_chip}_S1Hand.tif')
    lbl_path = os.path.join(RAW_DIR, 'LabelHand', f'{sample_chip}_LabelHand.tif')
    jrc_path = os.path.join(RAW_DIR, 'JRCWaterHand', f'{sample_chip}_JRCWaterHand.tif')

    s1 = tifffile.imread(s1_path)
    lbl = tifffile.imread(lbl_path)
    jrc = tifffile.imread(jrc_path) if os.path.exists(jrc_path) else np.zeros_like(lbl)

    vv = np.nan_to_num(s1[0], nan=-30.0)
    vh = np.nan_to_num(s1[1], nan=-35.0)

    # Predictions
    xgb_model = joblib.load(os.path.join(ARTIFACTS_DIR, 'xgboost_sar_flood.joblib'))
    feats = extract_chip_features(s1)
    H, W, C = feats.shape
    prob_xgb = xgb_model.predict_proba(feats.reshape(-1, C))[:, 1].reshape(H, W)
    pred_water = (prob_xgb > 0.5).astype(int)

    # Permanent water and candidate flood
    perm_water = (jrc == 1).astype(int)
    candidate_flood = pred_water & (~perm_water)

    # RGB SAR
    r = np.clip((vv - (-25)) / 20.0, 0, 1)
    g = np.clip((vh - (-30)) / 20.0, 0, 1)
    b = np.clip((vv - vh - 2) / 10.0, 0, 1)
    rgb = np.stack([r, g, b], axis=-1)

    fig, axes = plt.subplots(1, 5, figsize=(25, 5))

    # Panel 1: SAR Composite
    axes[0].imshow(rgb)
    axes[0].set_title("1. Sentinel-1 SAR Composite\n(R: VV, G: VH, B: VV-VH)", fontsize=11, fontweight='bold')
    axes[0].axis('off')

    # Panel 2: Ground Truth
    gt_disp = np.zeros((H, W, 3))
    gt_disp[lbl == 0] = [0.85, 0.85, 0.85] # Land: Gray
    gt_disp[lbl == 1] = [0.1, 0.4, 0.8]    # Water: Blue
    gt_disp[lbl == -1] = [0.2, 0.2, 0.2]   # Invalid: Dark gray
    axes[1].imshow(gt_disp)
    axes[1].set_title("2. Ground Truth Mask\n(Blue: Water, Gray: Land)", fontsize=11, fontweight='bold')
    axes[1].axis('off')

    # Panel 3: JRC Permanent Water
    jrc_disp = np.zeros((H, W, 3))
    jrc_disp[perm_water == 0] = [0.9, 0.9, 0.9]
    jrc_disp[perm_water == 1] = [0.0, 0.6, 0.6] # Cyan: Permanent Water
    axes[2].imshow(jrc_disp)
    axes[2].set_title("3. JRC Permanent Water\n(Cyan: Baseline Rivers/Lakes)", fontsize=11, fontweight='bold')
    axes[2].axis('off')

    # Panel 4: Model Water Prediction
    axes[3].imshow(pred_water, cmap='Blues')
    axes[3].set_title("4. Predicted Total Water\n(XGBoost SAR Classifier)", fontsize=11, fontweight='bold')
    axes[3].axis('off')

    # Panel 5: Candidate Flood Proxy
    flood_disp = np.zeros((H, W, 3))
    flood_disp[:, :] = [0.92, 0.92, 0.92]
    flood_disp[perm_water == 1] = [0.0, 0.6, 0.6]      # Baseline water (Cyan)
    flood_disp[candidate_flood == 1] = [0.85, 0.15, 0.15] # Candidate Flood (Red)
    axes[4].imshow(flood_disp)
    axes[4].set_title("5. Candidate Flood Proxy\n(Red: New Inundation, Cyan: River)", fontsize=11, fontweight='bold')
    axes[4].axis('off')

    plt.suptitle(f"FloodProof Verification Pipeline: India Monsoon Flood Event (Chip: {sample_chip})", fontsize=14, fontweight='bold', y=1.02)
    plt.tight_layout()

    out_fig = os.path.join(FIGURES_DIR, 'flood_detection_comparison_india.png')
    plt.savefig(out_fig, dpi=200, bbox_inches='tight')
    plt.close()
    print(f"Updated diagnostic figure saved to: {out_fig}")

if __name__ == '__main__':
    generate_visual_diagnostics()
