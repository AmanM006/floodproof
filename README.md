# FloodProof: Comprehensive Product Release & Verification Report

**Event:** AWS × WeMakeDevs Environmental Hacks (Heat and Water Track, October 8–11, 2026)  
**Status:** FULL PRODUCT COMPLETE — Scientific Reconciliation, Geodetic Invariants, Interactive Web Console, Real OSM Layers, Dynamic Inspection Planner, and Live AWS Deployment & Persistence.  
**System Positioning:** Historical satellite water investigation prototype with contextual mapped-infrastructure overlap and explainable inspection priorities.  
**Hosted Application:** `http://44.200.240.31/` (AWS EC2 `i-09dfc33e95fa1cc01`, us-east-1)  
**Live Amazon S3 Bucket:** `s3://floodproof-verification-artifacts-699158992887/`  
**Repository Path:** `c:\Users\aman\Documents\aws-wemake\floodproof`

---

## 1. Product Summary & Architecture

FloodProof is a human-in-the-loop decision tool designed for disaster response coordinators managing monsoon and riverine flood investigations:

1. **Satellite Ingestion & Preprocessing:** Ingests Sentinel-1 C-band Synthetic Aperture Radar (SAR) Ground Range Detected (GRD) GeoTIFFs (penetrates monsoon cloud cover).
2. **Dual-Model Detection & Baseline:**
   - **XGBoost Polarimetric/Spatial Classifier:** 7-feature SAR model evaluated on historical global events.
   - **Fixed SAR Threshold Baseline:** ($\text{VV} < -16\ \text{dB}, \text{VH} < -23\ \text{dB}$).
   - **Baseline JRC Permanent Water:** Identifies historical rivers, lakes, and reservoirs to prevent prioritizing permanent water bodies.
3. **Model Disagreement as an Inspection Feature:**
   - Highlights areas where the ML model and threshold baseline conflict (e.g. vegetation attenuation, emergent boundaries).
4. **Dynamic Inspection Planning:**
   - Evaluates 64 geodetic sectors (each ~0.57 km x 0.64 km, up to 36.47 ha).
   - Allows operator selection among transparent operational trade-offs:
     - `Fixed-Threshold Area-Only` (Strongest pooled annotated-water baseline)
     - `XGBoost Area-Only` (Area-only prioritization via ML candidate extent)
     - `Planner Infra-First` (Contextual prioritization of mapped road and building overlap)
     - `Planner Balanced` (Multi-criteria weighted scoring)
     - `Planner Conflict-First` (Active learning focus on model disagreement)
5. **Field Verification Task Assignment & State Machine:**
   - Manages task lifecycle: `unassigned` $\rightarrow$ `assigned` $\rightarrow$ `in_progress` $\rightarrow$ `operator_reviewed` $\rightarrow$ `field_verified` / `rejected` / `inconclusive`.
   - Optimistic concurrency control (`expected_version` validation with HTTP 409 Conflict rejection).
6. **AWS Cloud Persistence & Production Deployment:**
   - Live synchronization of field tasks to Amazon S3.
   - Fully deployed and running on AWS EC2 (`44.200.240.31`).

---

## 2. Qualified Evaluation Findings & Operational Trade-offs

Detailed metrics are codified in [`reports/planner_and_ml_evaluation.md`](file:///c:/Users/aman/Documents/aws-wemake/floodproof/reports/planner_and_ml_evaluation.md) and [`reports/planner_evaluation_summary.csv`](file:///c:/Users/aman/Documents/aws-wemake/floodproof/reports/planner_evaluation_summary.csv):

### A. Primary Test Split (17 Untouched India Scenes)
Target evaluated is **annotated water** (`label == 1` within valid data bounds; includes permanent water baseline).

| Budget $K$ | Strategy | Pooled Annotated Water Captured (%) | Pooled Road Overlap Captured (%)* | Pooled Building Overlap Captured (%)* | Pooled Disagreement Captured (%) |
| :---: | :--- | :---: | :---: | :---: | :---: |
| **$K=5$** | **Fixed-Threshold Area-Only (Baseline)** | **18.12%** | 0.00% | 0.00% | 15.70% |
| $K=5$ | XGBoost Area-Only (Baseline) | 17.62% | 0.00% | 0.00% | 21.08% |
| $K=5$ | Planner Infra-First (Targeted) | 17.24% | **69.25%** | **60.71%** | 20.59% |
| $K=5$ | Random Selection (Analytic Expected) | 7.81% | 7.81% | 7.82% | 7.81% |
| **$K=10$** | **Fixed-Threshold Area-Only (Baseline)** | **34.54%** | 0.00% | 0.00% | 28.56% |
| $K=10$ | XGBoost Area-Only (Baseline) | 31.14% | 0.00% | 0.00% | 37.39% |
| $K=10$ | **Planner Infra-First (Targeted)** | 30.36% | **69.25%** | **85.71%** | 36.86% |
| $K=10$ | Planner Balanced (Multi-Criteria) | 29.89% | 69.25% | 60.71% | 38.80% |
| $K=10$ | Planner Conflict-First (Active Learning) | 26.00% | 0.00% | 7.14% | **41.36%** |
| $K=10$ | Random Selection (Analytic Expected) | 15.62% | 15.62% | 15.64% | 15.62% |
| **$K=15$** | **Fixed-Threshold Area-Only (Baseline)** | **48.94%** | 0.00% | 0.00% | 41.30% |
| $K=15$ | Planner Balanced (Multi-Criteria) | 41.13% | 69.25% | 67.86% | 51.34% |
| $K=15$ | XGBoost Area-Only (Baseline) | 41.07% | 57.71% | 35.71% | 50.49% |
| $K=15$ | **Planner Infra-First (Targeted)** | 40.32% | **84.62%** | **92.86%** | 50.03% |
| $K=15$ | Random Selection (Analytic Expected) | 23.44% | 23.44% | 23.43% | 23.44% |

### B. Core Operational Positioning & Scope
- **Strongest Water Baseline:** `Fixed-Threshold Area-Only` captures the highest pooled annotated-water volume across all budgets ($34.54\%$ at $K=10$, $48.94\%$ at $K=15$).
- **Contextual Infrastructure Overlap:** Mapped OpenStreetMap (OSM) infrastructure within our cached dataset bounds covers **one demonstration scene (`India_591317`)**.
- **Qualified Finding:** *“On one Assam demonstration scene, infrastructure-first planning selects 10 of 64 sectors containing approximately 69% of predicted mapped-road overlap and 86% of predicted mapped-building overlap.”*
  - This measures **predicted contextual overlap**, not confirmed physical damage or independently validated ground impact.
- **Consistent Sector-Derived Denominators:** Denominators and numerators are derived directly from sector sums ($245.20\text{ m}$ road overlap, $0.2800\text{ ha}$ building overlap) and reconcile within rounding tolerance to the scene summary.
- **Analytic Random Baseline:** Evaluated against exact analytic expected values ($K / 64$), demonstrating substantial active planning gains across all budgets.

---

## 3. Spatial Geometry & Rigor

 codifies spatial invariants in [`tests/test_infrastructure_geometry.py`](file:///c:/Users/aman/Documents/aws-wemake/floodproof/tests/test_infrastructure_geometry.py):
1. **Haversine Geodetic Accuracy:** Confirmed geodetic length calculation against equatorial (111.319 km) and meridian (111.195 km) 1-degree arcs within $0.05\%$.
2. **Multipolygon Relations with Inner Ring Holes:** OSM `type=multipolygon` relations subtract interior hole courtyards during rasterization ($10,201\text{ px}$ outer minus $2,601\text{ px}$ inner $\rightarrow 76.0\text{ ha}$ net building footprint).
3. **Sector Boundary Crossing:** Disjoint 64-sector summation reconciles with overall scene totals within rounding tolerance (zero double counting).
4. **Scene Boundary Clipping:** Out-of-bounds geographic coordinates map to 0 without boundary faults.
- **Test Evidence:** All 4 tests pass cleanly in 0.53s; raw output is recorded in [`reports/test_infrastructure_geometry.log`](file:///c:/Users/aman/Documents/aws-wemake/floodproof/reports/test_infrastructure_geometry.log).

---

## 4. End-to-End Test Suite

Run all verification tests:
```powershell
# 1. Spatial geometry invariants and hole subtraction
python -m pytest tests/test_infrastructure_geometry.py -v

# 2. Offline pipeline, affine geotiff validation, and S3 recovery
python -m pytest tests/test_end_to_end.py -k "not test_nextjs and not test_tasks_api" -v
```

---

## 5. Live Application Access

- **Hosted URL:** `http://44.200.240.31/`
- **Hosted API Endpoint:** `http://44.200.240.31/api/scenes`
- **Tasks Endpoint:** `http://44.200.240.31/api/tasks`
