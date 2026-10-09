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
- **Measured CPU Latency:**
  - Feature Preparation: **20.3 ms**
  - Warm Inference: **146.4 ms**
  - Post-processing & Geodetic Queue: **2.2 ms**
  - Total Steady-State Request Latency: **168.8 ms** (Memory footprint: ~92 MB).

---

## 5. Automated Verification Test Suite

All tests pass cleanly in [`tests/test_end_to_end.py`](file:///c:/Users/aman/Documents/aws-wemake/floodproof/tests/test_end_to_end.py):
1. `test_geodesy_invariant`: PASSED (Candidate water area bounded by valid sector area across all latitudes).
2. `test_s3_cloud_roundtrip`: PASSED (Live S3 write, read-back, and payload verification).
3. `test_task_lifecycle_and_audit_history`: PASSED (Task state machine progression and transition logging).
4. `test_model_artifact_load`: PASSED (XGBoost model validation).

---

## 6. How to Run the Application

To launch the full browser-based operator console:
```powershell
cd c:\Users\aman\Documents\aws-wemake\floodproof
streamlit run src\product\app.py
```
To run the automated verification test suite:
```powershell
python -c "import sys; sys.path.insert(0, '.'); import tests.test_end_to_end as t; t.test_geodesy_invariant(); t.test_s3_cloud_roundtrip(); t.test_task_lifecycle_and_audit_history(); t.test_model_artifact_load(); print('ALL TESTS PASSED')"
```
