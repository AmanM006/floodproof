"""
Targeted Dataset Acquisition Script for FloodProof.

Downloads hand-labeled Sentinel-1 GRD SAR chips (VV/VH dB) and ground-truth masks
from the official Sen1Floods11 release v1.1 GCS bucket:
- Training events: Ghana, Pakistan, Somalia, Nigeria, Spain (~40 chips)
- Validation event: Sri Lanka (12 chips)
- Held-out test event 1: India (2016-08-12 Bihar/Assam Monsoon Flood Event, 20 chips)
- Held-out test event 2: Paraguay (15 chips)

Total volume: ~87 chips (~140 MB), perfectly sized for local RAM and rapid reproducibility.
"""

import os
import urllib.request
import pandas as pd
import hashlib

BASE_URL = "https://storage.googleapis.com/sen1floods11/v1.1/data/flood_events/HandLabeled"
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'raw')
MANIFEST_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'manifests', 'downloaded_chips.csv')

# Selections by country / event
TARGET_CONFIG = {
    'train': [
        ('Ghana', 10),
        ('Pakistan', 10),
        ('Somalia', 8),
        ('Nigeria', 6),
        ('Spain', 8)
    ],
    'val': [
        ('Sri-Lanka', 10)
    ],
    'test_india': [
        ('India', 18)
    ],
    'test_unseen_paraguay': [
        ('Paraguay', 12)
    ]
}

def get_chip_list_from_split(split_name, country, limit):
    csv_path = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'manifests', f'{split_name}.csv')
    df = pd.read_csv(csv_path, header=None, names=['s1', 'lbl'])
    matching = df[df['s1'].str.startswith(f"{country}_")].head(limit)
    return matching.values.tolist()

def download_file(url, target_path):
    if os.path.exists(target_path) and os.path.getsize(target_path) > 0:
        return True
    try:
        urllib.request.urlretrieve(url, target_path)
        return True
    except Exception as e:
        print(f"Error downloading {url}: {e}")
        return False

def compute_sha256(filepath):
    h = hashlib.sha256()
    with open(filepath, 'rb') as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()

def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(os.path.join(DATA_DIR, 'S1Hand'), exist_ok=True)
    os.makedirs(os.path.join(DATA_DIR, 'LabelHand'), exist_ok=True)
    os.makedirs(os.path.join(DATA_DIR, 'JRCWaterHand'), exist_ok=True)

    records = []

    # 1. Training chips
    for country, limit in TARGET_CONFIG['train']:
        chips = get_chip_list_from_split('flood_train_data', country, limit)
        for s1_file, lbl_file in chips:
            records.append({'country': country, 'split': 'train', 's1_file': s1_file, 'lbl_file': lbl_file})

    # 2. Validation chips
    for country, limit in TARGET_CONFIG['val']:
        chips = get_chip_list_from_split('flood_valid_data', country, limit)
        for s1_file, lbl_file in chips:
            records.append({'country': country, 'split': 'val', 's1_file': s1_file, 'lbl_file': lbl_file})

    # 3. Test India chips (from test split + train split if needed to get sufficient coverage)
    chips_in = get_chip_list_from_split('flood_test_data', 'India', 14)
    for s1_file, lbl_file in chips_in:
        records.append({'country': 'India', 'split': 'test_india', 's1_file': s1_file, 'lbl_file': lbl_file})
    # Add a few more from valid if needed
    chips_in_v = get_chip_list_from_split('flood_valid_data', 'India', 4)
    for s1_file, lbl_file in chips_in_v:
        records.append({'country': 'India', 'split': 'test_india', 's1_file': s1_file, 'lbl_file': lbl_file})

    # 4. Test Paraguay chips (unseen South American event)
    chips_py = get_chip_list_from_split('flood_test_data', 'Paraguay', 12)
    for s1_file, lbl_file in chips_py:
        records.append({'country': 'Paraguay', 'split': 'test_paraguay', 's1_file': s1_file, 'lbl_file': lbl_file})

    manifest_df = pd.DataFrame(records).drop_duplicates(subset=['s1_file']).reset_index(drop=True)
    print(f"Total chips targeted for download: {len(manifest_df)}")
    print(manifest_df['split'].value_counts())

    successful_downloads = []
    for idx, row in manifest_df.iterrows():
        s1 = row['s1_file']
        lbl = row['lbl_file']
        chip_id = s1.replace('_S1Hand.tif', '')

        s1_url = f"{BASE_URL}/S1Hand/{s1}"
        lbl_url = f"{BASE_URL}/LabelHand/{lbl}"
        jrc_url = f"{BASE_URL}/JRCWaterHand/{chip_id}_JRCWaterHand.tif"

        p_s1 = os.path.join(DATA_DIR, 'S1Hand', s1)
        p_lbl = os.path.join(DATA_DIR, 'LabelHand', lbl)
        p_jrc = os.path.join(DATA_DIR, 'JRCWaterHand', f"{chip_id}_JRCWaterHand.tif")

        ok1 = download_file(s1_url, p_s1)
        ok2 = download_file(lbl_url, p_lbl)
        ok3 = download_file(jrc_url, p_jrc) # Note: some may not have JRC

        if ok1 and ok2:
            successful_downloads.append({
                'chip_id': chip_id,
                'country': row['country'],
                'split': row['split'],
                's1_file': p_s1,
                'lbl_file': p_lbl,
                'jrc_file': p_jrc if os.path.exists(p_jrc) else None,
                's1_sha256': compute_sha256(p_s1),
                'lbl_sha256': compute_sha256(p_lbl)
            })

        if (idx + 1) % 10 == 0:
            print(f"Downloaded [{idx+1}/{len(manifest_df)}] chips...")

    result_df = pd.DataFrame(successful_downloads)
    result_df.to_csv(MANIFEST_PATH, index=False)
    print(f"\nTargeted Acquisition Complete! Downloaded {len(result_df)} complete chips.")
    print(f"Saved manifest to: {MANIFEST_PATH}")

if __name__ == '__main__':
    main()
