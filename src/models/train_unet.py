"""
Compact PyTorch U-Net Segmentation Candidate for FloodProof.

Designed specifically for CPU execution:
- Channels: 16 -> 32 -> 64 (compact depth, ~110k parameters)
- Inputs: 2 channels (VV, VH normalized dB)
- Outputs: 1 channel logit (binary water vs non-water)
- Loss: Binary Cross-Entropy with Masking (ignores -1 no-data pixels)
- Memory: Low footprint (< 50 MB), fits comfortably within available RAM.
"""

import os
import time
import numpy as np
import pandas as pd
import tifffile
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from sklearn.metrics import jaccard_score, precision_score, recall_score, f1_score, accuracy_score

MANIFEST_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'manifests', 'downloaded_chips.csv')
ARTIFACTS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'artifacts')
REPORTS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'reports')

class DoubleConv(nn.Module):
    def __init__(self, in_ch, out_ch):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(in_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True)
        )
    def forward(self, x):
        return self.conv(x)

class CompactUNet(nn.Module):
    def __init__(self, in_channels=2, out_channels=1):
        super().__init__()
        self.inc = DoubleConv(in_channels, 16)
        self.down1 = nn.Sequential(nn.MaxPool2d(2), DoubleConv(16, 32))
        self.down2 = nn.Sequential(nn.MaxPool2d(2), DoubleConv(32, 64))
        
        self.up1 = nn.ConvTranspose2d(64, 32, 2, stride=2)
        self.conv_up1 = DoubleConv(64, 32)
        self.up2 = nn.ConvTranspose2d(32, 16, 2, stride=2)
        self.conv_up2 = DoubleConv(32, 16)
        
        self.outc = nn.Conv2d(16, out_channels, 1)

    def forward(self, x):
        x1 = self.inc(x)
        x2 = self.down1(x1)
        x3 = self.down2(x2)
        
        u1 = self.up1(x3)
        u1 = torch.cat([u1, x2], dim=1)
        u1 = self.conv_up1(u1)
        
        u2 = self.up2(u1)
        u2 = torch.cat([u2, x1], dim=1)
        u2 = self.conv_up2(u2)
        
        logits = self.outc(u2)
        return logits

class S1FloodDataset(Dataset):
    def __init__(self, df):
        self.items = df.to_dict('records')

    def __len__(self):
        return len(self.items)

    def __getitem__(self, idx):
        row = self.items[idx]
        s1 = tifffile.imread(row['s1_file'])
        lbl = tifffile.imread(row['lbl_file'])

        # Preprocess S1: replace NaNs, clip dB to [-35, 5], normalize to [-1, 1]
        vv = np.clip(np.nan_to_num(s1[0], nan=-30.0), -35.0, 5.0)
        vh = np.clip(np.nan_to_num(s1[1], nan=-35.0), -35.0, 5.0)
        vv_norm = (vv - (-15.0)) / 10.0
        vh_norm = (vh - (-22.0)) / 10.0
        x_arr = np.stack([vv_norm, vh_norm], axis=0).astype(np.float32)

        y_arr = lbl.astype(np.int64)
        return torch.tensor(x_arr), torch.tensor(y_arr)

def masked_bce_loss(logits, targets):
    valid_mask = (targets >= 0)
    if valid_mask.sum() == 0:
        return torch.tensor(0.0, requires_grad=True)
    targets_float = targets[valid_mask].float()
    logits_valid = logits.squeeze(1)[valid_mask]
    return nn.functional.binary_cross_entropy_with_logits(logits_valid, targets_float)

def train_compact_unet():
    torch.manual_seed(42)
    np.random.seed(42)
    df = pd.read_csv(MANIFEST_PATH)
    train_df = df[df['split'] == 'train'].reset_index(drop=True)
    val_df = df[df['split'] == 'val'].reset_index(drop=True)

    train_loader = DataLoader(S1FloodDataset(train_df), batch_size=4, shuffle=True)
    val_loader = DataLoader(S1FloodDataset(val_df), batch_size=4, shuffle=False)

    model = CompactUNet(in_channels=2, out_channels=1)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.002, weight_decay=1e-4)

    print(f"Compact U-Net created. Total params: {sum(p.numel() for p in model.parameters()):,}")

    best_val_loss = float('inf')
    best_state = None
    num_epochs = 6 # Bounded for CPU execution within 3 minutes

    print("--- Training Compact U-Net on CPU ---")
    t0 = time.time()
    for ep in range(1, num_epochs + 1):
        model.train()
        train_loss = 0.0
        for bx, by in train_loader:
            optimizer.zero_grad()
            out = model(bx)
            loss = masked_bce_loss(out, by)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * len(bx)
        train_loss /= len(train_loader.dataset)

        model.eval()
        val_loss = 0.0
        with torch.no_grad():
            for bx, by in val_loader:
                out = model(bx)
                loss = masked_bce_loss(out, by)
                val_loss += loss.item() * len(bx)
        val_loss /= len(val_loader.dataset)

        print(f"Epoch {ep:02d}/{num_epochs:02d}: Train Loss={train_loss:.4f} | Val Loss={val_loss:.4f}")
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_state = model.state_dict().copy()

    print(f"Training completed in {time.time() - t0:.2f}s.")
    model.load_state_dict(best_state)
    torch.save(model.state_dict(), os.path.join(ARTIFACTS_DIR, 'compact_unet.pt'))

    # Evaluate on held-out evaluation sets
    test_eval_sets = {
        'Validation (Sri Lanka)': df[df['split'] == 'val'],
        'Test Event (India Monsoon)': df[df['split'] == 'test_india'],
        'Test Event (Paraguay)': df[df['split'] == 'test_paraguay']
    }

    unet_results = []
    for set_name, c_df in test_eval_sets.items():
        loader = DataLoader(S1FloodDataset(c_df), batch_size=1, shuffle=False)
        all_yt = []
        all_yp = []
        t_infer = 0.0

        model.eval()
        with torch.no_grad():
            for bx, by in loader:
                t_s = time.perf_counter()
                out = model(bx)
                prob = torch.sigmoid(out).squeeze().cpu().numpy()
                t_infer += (time.perf_counter() - t_s)

                pred = (prob > 0.5).astype(int)
                target = by.squeeze().cpu().numpy()

                valid = (target >= 0)
                all_yt.append(target[valid])
                all_yp.append(pred[valid])

        yt_arr = np.concatenate(all_yt)
        yp_arr = np.concatenate(all_yp)

        iou = jaccard_score(yt_arr, yp_arr, pos_label=1, zero_division=0)
        prec = precision_score(yt_arr, yp_arr, pos_label=1, zero_division=0)
        rec = recall_score(yt_arr, yp_arr, pos_label=1, zero_division=0)
        f1 = f1_score(yt_arr, yp_arr, pos_label=1, zero_division=0)
        acc = accuracy_score(yt_arr, yp_arr)

        unet_results.append({
            'evaluation_set': set_name,
            'model': 'Compact U-Net (PyTorch)',
            'flood_iou': round(float(iou), 4),
            'precision': round(float(prec), 4),
            'recall': round(float(rec), 4),
            'f1': round(float(f1), 4),
            'pixel_accuracy': round(float(acc), 4),
            'latency_ms_per_chip': round((t_infer / len(c_df)) * 1000, 2)
        })

    # Combine with existing benchmarks
    bench_csv = os.path.join(REPORTS_DIR, 'benchmark.csv')
    existing_df = pd.read_csv(bench_csv)
    full_df = pd.concat([existing_df, pd.DataFrame(unet_results)], ignore_index=True)
    full_df = full_df.sort_values(by=['evaluation_set', 'flood_iou'], ascending=[True, False])
    full_df.to_csv(bench_csv, index=False)

    print("\n================ COMPREHENSIVE BENCHMARK WITH U-NET ================")
    print(full_df.to_string(index=False))

if __name__ == '__main__':
    train_compact_unet()
