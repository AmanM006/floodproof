# FloodProof Dataset Quality Audit

## 1. Overview & Provenance
- **Dataset Name:** Sen1Floods11 (v1.1 Hand-Labeled Ground Truth)
- **Repository Source:** `https://github.com/cloudtostreet/Sen1Floods11`
- **Storage Location:** `https://storage.googleapis.com/sen1floods11/v1.1/data/flood_events/HandLabeled/`
- **Licensing:** CC BY 4.0 / Open Access satellite research standard.
- **Sensors:** Sentinel-1 C-band Synthetic Aperture Radar (SAR) Ground Range Detected (GRD).
- **Bands:** Band 1 = VV (Vertical transmit/Vertical receive, dB), Band 2 = VH (Vertical transmit/Horizontal receive, dB).
- **Chip Dimensions:** 512 x 512 pixels per chip at 10m spatial resolution (~5.12 km x 5.12 km footprint).

## 2. Ingested Geographic Corpus
- **Total Downloaded Chips:** 81
- **Split Allocation:**
  - `train` (42 chips): Ghana, Pakistan, Somalia, Nigeria, Spain
  - `val` (9 chips): Sri Lanka
  - `test_india` (18 chips): **India Monsoon Flood Event** (2016-08-12, Bihar/Assam region, held-out test)
  - `test_paraguay` (12 chips): **Paraguay Flood Event** (unseen geography test)

## 3. Pixel Class Distribution & Balance
- **Total Evaluated Pixels:** 21,233,664
- **Non-Water (Class 0):** 15,929,547 (88.64% of valid pixels)
- **Water / Flooded (Class 1):** 2,040,714 (11.36% of valid pixels)
- **Invalid / No-data (Class -1):** 3,263,403 (15.37% of total pixels)
- **Array Sanity:** 0 NaNs or Inf values; backscatter correctly scaled in decibels (-50 dB to +20 dB typical SAR range).

## 4. Class Balance Summary by Split

| Split | Chips | Non-Water Pixels (0) | Water Pixels (1) | Water % |
|---|---|---|---|---|
| `test_india` | 18 | 3,220,750 | 798,510 | 19.87% |
| `test_paraguay` | 12 | 2,567,899 | 214,011 | 7.69% |
| `train` | 42 | 8,120,832 | 853,158 | 9.51% |
| `val` | 9 | 2,020,066 | 175,035 | 7.97% |
