# FloodProof: Comprehensive Product Release & Verification Report

**Event:** AWS × WeMakeDevs Environmental Hacks (Heat and Water Track, October 8–11, 2026)  
**Status:** FULL PRODUCT COMPLETE — Scientific Reconciliation, Geodetic Invariants, Interactive Web Console, Real OSM Layers, and Live AWS S3 Persistence.  
**Repository Path:** `c:\Users\aman\Documents\aws-wemake\floodproof` (Git Commits: `8339a1b`, `cce92e8`, `ca635a5`, and release HEAD)  
**Live Amazon S3 Bucket:** `s3://floodproof-verification-artifacts-699158992887/`

---

## 1. Product Summary & Architecture

FloodProof is a human-in-the-loop decision tool designed for disaster response coordinators managing monsoon and riverine flood events:
1. **Satellite Ingestion & Preprocessing:** Ingests Sentinel-1 C-band Synthetic Aperture Radar (SAR) Ground Range Detected (GRD) GeoTIFFs (penetrates monsoon cloud cover).
2. **Dual-Model Detection & Baseline:**
   - **XGBoost Polarimetric/Textural Classifier:** 7-feature SAR model trained on historical global events.
   - **Fixed SAR Threshold Baseline:** ($\text{VV} < -16\ \text{dB}, \text{VH} < -23\ \text{dB}$).
   - **Baseline JRC Permanent Water:** Separates historical rivers, lakes, and reservoirs to prevent dispatching rescue teams to permanent water bodies.
3. **Model Disagreement as a Primary Decision Feature:**
   - Surfaces areas where the ML model and threshold baseline conflict (e.g. vegetation attenuation, flooded urban double-bounce).
4. **Field Verification Task Assignment & State Machine:**
   - Evaluates 64x64 geodetic sectors (each ~0.57 km x 0.64 km, up to 36.47 ha).
   - Manages task lifecycle: `unassigned` $\rightarrow$ `assigned` $\rightarrow$ `in_progress` $\rightarrow$ `operator_reviewed` $\rightarrow$ `field_verified` / `rejected` / `inconclusive`.
5. **Real AWS Cloud Persistence:**
   - Live synchronization of field tasks and audit manifests to Amazon S3.

---

## 2. Scientific & Mathematical Foundation

### A. Geodetic Area Invariant Resolution
In earlier draft reports, flat nominal approximations (100 m²/pixel) caused mathematical discrepancies (e.g. claiming a 4,096-pixel sector contained >32.89 ha).
- **Exact Ellipsoidal Calculation:** Using the WGS84 ellipsoid ($a = 6,378,137.0\ \text{m}$, $1/f = 298.257223563$) at the latitude of Assam (26.63°N):
  - **Pixel Width (East-West):** $8.9452\ \text{m}$
  - **Pixel Height (North-South):** $9.9531\ \text{m}$
  - **True Pixel Area:** $89.0326\ \text{m}^2$ ($0.008903\ \text{ha}$)
  - **Full Chip (512 x 512):** $4.580\ \text{km} \times 5.096\ \text{km} = 23.339\ \text{km}^2$ ($2,333.94\ \text{ha}$)
  - **Single Sector (64 x 64 = 4,096 px maximum):** $36.4677\ \text{ha}$ maximum
- **Hard Code Invariant:** Enforced in `src/evaluation/geodesy.py`:
  $$\text{Candidate Water Area} \le \text{Valid Sector Area} \le 36.47\ \text{ha}$$

### B. Benchmark Metric Reconciliation
Reconciled in [`reports/reconciliation_benchmarks.csv`](file:///c:/Users/aman/Documents/aws-wemake/floodproof/reports/reconciliation_benchmarks.csv):
- **Diagnostic Sample Quarantined:** Chip `India_900498` was strictly quarantined as an exploratory diagnostic training example. Indian generalisation is evaluated on the **17 strictly untouched scenes**:

| Split | Model | Pooled Water IoU | Mean-per-Chip Water IoU | Pooled Prec | Mean-per-Chip Prec | Pooled Recall | Mean-per-Chip Recall | Pooled Accuracy |
|---|---|---|---|---|---|---|---|---|
| **India (17 Untouched Chips)** | **XGBoost Classifier** | **0.6401** | **0.4034** | **0.7894** | 0.5354 | **0.7718** | **0.5243** | **92.21%** |
| India (17 Untouched Chips) | Fixed SAR Threshold | 0.5325 | 0.2644 | 0.9021 | **0.6951** | 0.5652 | 0.2822 | 91.09% |
| India (17 Untouched Chips) | Adaptive Otsu Threshold | 0.3378 | 0.2864 | 0.3691 | 0.3378 | 0.7990 | 0.7281 | 71.88% |
| India (17 Untouched Chips) | Compact U-Net (CPU) | 0.0510 | 0.0510 | 0.8781 | 0.6771 | 0.0514 | 0.0513 | 82.84% |
| **Paraguay (12 Chips)** | **Fixed SAR Threshold** | **0.5770** | **0.4207** | **0.8129** | **0.6561** | 0.6654 | 0.4747 | **96.25%** |
| Paraguay (12 Chips) | XGBoost Classifier | 0.3384 | 0.3667 | 0.4249 | 0.4131 | 0.6243 | **0.6461** | 90.61% |
| Paraguay (12 Chips) | Adaptive Otsu Threshold | 0.1782 | 0.2426 | 0.1949 | 0.2592 | **0.6749** | 0.7092 | 76.06% |

---

## 3. Real OpenStreetMap Infrastructure Integration

To avoid manufactured settlement statistics, we retrieved and integrated genuine OpenStreetMap infrastructure data covering the Assam flood footprint:
- **Data Source:** OpenStreetMap Overpass API (`http://overpass-api.de/api/interpreter`)
- **Coverage Extent:** Longitude [92.85°, 92.96°], Latitude [26.58°, 26.68°] (Assam, India)
- **Elements Ingested:** 1,204 total OSM elements, including verified settlements (towns, villages, hamlets) and 47 road segments (`primary`, `secondary`, `residential`).
- **File Location:** [`data/raw/osm_assam_infrastructure.json`](file:///c:/Users/aman/Documents/aws-wemake/floodproof/data/raw/osm_assam_infrastructure.json).

---

## 4. Real AWS S3 Cloud Integration & Profiling

- **Live S3 Bucket:** `s3://floodproof-verification-artifacts-699158992887/` (Region: `us-east-1`, Account: `699158992887`).
- **Verified Operations:**
  - `s3://floodproof-verification-artifacts-699158992887/models/xgboost_sar_flood.joblib` (Model storage)
  - `s3://floodproof-verification-artifacts-699158992887/tasks/verification_tasks.json` (Live task synchronization)
  - `s3://floodproof-verification-artifacts-699158992887/audit_logs/operator_decisions_log.csv` (Audit trail)
- **Automated Roundtrip Test:** `test_s3_cloud_roundtrip` verified live writing and immediate read-back from S3.
- **Measured CPU Latency (Full End-to-End Execution):**
  - Feature Preparation (7 polarimetric & context channels): **9.2 ms - 18.7 ms**
  - XGBoost Prediction (512x512 = 262,144 px with valid mask): **1,472.2 ms - 2,364.2 ms**
  - Geodetic Invariant Sector Ranking & Triage (64 sectors): **4.1 ms**
  - Transparent RGBA PNG Raster Rendering (4 layers): **104.0 ms - 264.6 ms**
  - Total Steady-State End-to-End Request Latency: **~1.6 s - 2.7 s** (Memory footprint: ~97 MB).

---

## 5. Automated Verification Test Suite

All 11 tests pass cleanly in [`tests/test_end_to_end.py`](file:///c:/Users/aman/Documents/aws-wemake/floodproof/tests/test_end_to_end.py):
1. `test_full_pipeline_execution`: Complete GeoTIFF execution with verified JRC alignment and 4 transparent RGBA image layers.
2. `test_unreferenced_geotiff_rejection`: Immediate rejection of rasters lacking `ModelPixelScaleTag` or `ModelTiepointTag`.
3. `test_crs_strict_wgs84_enforcement`: Rejection of missing CRS, projected CRS, and non-WGS84 datums (e.g. NAD83 EPSG:4269).
4. `test_nonzero_tiepoint_calculation`: Accurate affine origin recovery when tiepoint offsets $(i, j) \ne (0,0)$.
5. `test_jrc_subpixel_and_one_pixel_shift_rejection`: Rejection of single-pixel shifts and accumulated sub-pixel resolution drift ($>0.05$ px across 512 px).
6. `test_validity_mask_strict_preservation`: Raw invalid radar pixels (NaN / out-of-range) strictly masked before imputation.
7. `test_geodesy_no_silent_capping_and_invariant_violation`: Verified ellipsoidal area varies with latitude and candidate water exceeding valid area raises `ValueError`.
8. `test_nextjs_tasks_api_transitions_and_evidence`: Enforced `ALLOWED_TRANSITIONS` state machine and $\ge 10$ character traceable ground evidence for `field_verified`.
9. `test_tasks_api_optimistic_concurrency_conflict`: HTTP 409 Conflict returned when `expected_version` is stale.
10. `test_tasks_api_get_truthful_cloud_sync_and_recovery`: GET `/api/tasks` truthfully reports `cloud_synced` and auto-recovers from S3.
11. `test_s3_cloud_roundtrip`: Live write and immediate readback from AWS S3 bucket.

---

## 6. How to Run the Application

To launch the full browser-based Next.js + TypeScript operator workspace:
```powershell
cd c:\Users\aman\Documents\aws-wemake\floodproof\web
npm run dev
```
Open **`http://localhost:3000`** in any web browser.

To run the automated verification test suite:
```powershell
python tests/test_end_to_end.py
```
