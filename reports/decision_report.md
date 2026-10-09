# FloodProof: Final Submission-Ready Decision & Evidence Report

**Event:** AWS × WeMakeDevs Environmental Hacks (Heat and Water Track, October 8–11, 2026)  
**Product:** FloodProof — Satellite Radar Surface Water Detection & Field Verification Triage  
**Workspace:** `c:\Users\aman\Documents\aws-wemake\floodproof` (Git Commits: `8339a1b`, `cce92e8`, and current HEAD)  
**AWS Bucket:** `s3://floodproof-verification-artifacts-699158992887/`

---

## 1. Executive Problem & Scope

During major flood disasters—such as the annual monsoon inundations across the Brahmaputra Basin in Assam—emergency response coordinators face an information bottleneck:
- **Optical satellite imagery is blocked by monsoon cloud cover.**
- **Traditional flood maps color rivers and temporary flooding identically**, misdirecting rescue teams toward permanent lakes and riverbeds.
- **Automated ML models disagree with simple baselines** in complex vegetated and urban terrain, leaving operators uncertain about which satellite alerts require physical ground verification.

**FloodProof delivers a transparent human-in-the-loop decision tool:**
1. Ingests all-weather Copernicus Sentinel-1 C-band Synthetic Aperture Radar (SAR) imagery.
2. Delineates surface water using trained ML and fixed thresholding, separating baseline permanent water via historical JRC water archives.
3. Explicitly visualizes **Model Disagreement** (areas where the ML model and threshold baseline conflict).
4. Generates a **Ranked Field Verification Queue** prioritizing candidate flood extent, empowering coordinators to confirm, reject, or assign ground teams with full cloud audit logging on AWS.

---

## 2. Benchmark Reconciliation & Evaluation Table

A critical audit requirement was reconciling original pooled-pixel metrics with mean-per-chip metrics. 

### Why the Metrics Differ (Reconciliation Formula):
- **Pooled-Pixel Metrics:** Aggregates all true positives, false positives, and false negatives across every pixel in the split:
  $$\text{IoU}_{\text{pooled}} = \frac{\sum \text{TP}_i}{\sum \text{TP}_i + \sum \text{FP}_i + \sum \text{FN}_i}$$
  *Effect:* Gives higher weight to scenes with larger unmasked areas and higher water fractions.
- **Mean-per-Chip Metrics:** Calculates $\text{IoU}_i$ per chip independently and takes the unweighted arithmetic mean:
  $$\text{IoU}_{\text{mean}} = \frac{1}{N} \sum_{i=1}^N \text{IoU}_i$$
  *Effect:* Treats each satellite scene as an independent geographic observation, preventing a single high-water scene from skewing the score.
- **Diagnostic Sample Quarantine:** Chip `India_900498` was utilized during exploratory visual diagnosis and single-chip overfit capacity checks. To maintain untouched test integrity, we evaluate the India test split **both with and without `India_900498`** (17 strictly untouched scenes).

### Reconciled Multi-Event Benchmark Results
*Source: [`reports/reconciliation_benchmarks.csv`](file:///c:/Users/aman/Documents/aws-wemake/floodproof/reports/reconciliation_benchmarks.csv)*

| Evaluation Split | Model Candidate | Pooled Water IoU | Mean-per-Chip Water IoU | Pooled Precision | Mean-per-Chip Precision | Pooled Recall | Mean-per-Chip Recall | Pooled Accuracy | Chips |
|---|---|---|---|---|---|---|---|---|---|
| **India Test (17 Untouched Chips)** | **XGBoost Classifier** | **0.6401** | **0.4034** | **0.7894** | 0.5354 | **0.7718** | **0.5243** | **92.21%** | 17 |
| India Test (17 Untouched Chips) | Fixed SAR Threshold | 0.5325 | 0.2644 | 0.9021 | **0.6951** | 0.5652 | 0.2822 | 91.09% | 17 |
| India Test (17 Untouched Chips) | Adaptive Otsu Threshold | 0.3378 | 0.2864 | 0.3691 | 0.3378 | 0.7990 | 0.7281 | 71.88% | 17 |
| India Test (17 Untouched Chips) | Compact U-Net (PyTorch CPU) | 0.0510 | 0.0510 | 0.8781 | 0.6771 | 0.0514 | 0.0513 | 82.84% | 17 |
| **India Test (All 18 Chips)** | **XGBoost Classifier** | **0.6605** | **0.4241** | 0.7979 | 0.5523 | **0.7932** | **0.5457** | **91.90%** | 18 |
| India Test (All 18 Chips) | Fixed SAR Threshold | 0.5458 | 0.2842 | **0.9092** | **0.7090** | 0.5773 | 0.3022 | 90.46% | 18 |
| India Test (All 18 Chips) | Adaptive Otsu Threshold | 0.3682 | 0.3100 | 0.4052 | 0.3662 | 0.8011 | 0.7327 | 72.69% | 18 |
| India Test (All 18 Chips) | Compact U-Net (PyTorch CPU) | 0.0611 | 0.0547 | 0.8930 | 0.6912 | 0.0616 | 0.0550 | 81.21% | 18 |
| **Paraguay Test (12 Chips)** | **Fixed SAR Threshold** | **0.5770** | **0.4207** | **0.8129** | **0.6561** | 0.6654 | 0.4747 | **96.25%** | 12 |
| Paraguay Test (12 Chips) | XGBoost Classifier | 0.3384 | 0.3667 | 0.4249 | 0.4131 | 0.6243 | **0.6461** | 90.61% | 12 |
| Paraguay Test (12 Chips) | Adaptive Otsu Threshold | 0.1782 | 0.2426 | 0.1949 | 0.2592 | **0.6749** | 0.7092 | 76.06% | 12 |
| Paraguay Test (12 Chips) | Compact U-Net (PyTorch CPU) | 0.0442 | 0.0552 | 0.7690 | 0.6264 | 0.0448 | 0.0591 | 92.55% | 12 |
| **Validation (Sri Lanka, 9 Chips)** | **XGBoost Classifier** | **0.4253** | **0.2702** | 0.4789 | 0.3096 | 0.7914 | 0.5082 | 91.47% | 9 |
| Validation (Sri Lanka, 9 Chips) | Fixed SAR Threshold | 0.2022 | 0.1466 | **0.7019** | **0.4157** | 0.2212 | 0.1600 | **93.04%** | 9 |
| Validation (Sri Lanka, 9 Chips) | Adaptive Otsu Threshold | 0.1850 | 0.1896 | 0.1887 | 0.1972 | **0.9040** | **0.8061** | 68.25% | 9 |
| Validation (Sri Lanka, 9 Chips) | Compact U-Net (PyTorch CPU) | 0.0554 | 0.0416 | 0.9667 | 0.4755 | 0.0555 | 0.0417 | 92.45% | 9 |

### Honest Takeaway on Model Performance:
1. **India Performance Remains Strong:** On the 17 strictly untouched Indian flood scenes, XGBoost achieves **0.6401 Pooled IoU** (vs. 0.5325 for Fixed Threshold) and **0.4034 Mean-per-Chip IoU** (vs. 0.2644 for Fixed Threshold, a **+52.6% relative gain**).
2. **Domain Transfer Limits Disclosed:** On the Paraguay test event, the Fixed Threshold outperforms XGBoost (0.5770 vs. 0.3384 Pooled IoU). XGBoost trained on Asian/African flood scenes shows a drop when transferred to South American wetland basins.
3. **Product Decision:** Rather than enforcing a single model across all geographies, FloodProof presents **Model Disagreement as a first-class operational feature**, exposing where models disagree so humans can make informed verification decisions.

---

## 3. Corrected Multi-Chip Verification Dispatch Benchmark

Evaluated across 7 test scenes with exact geographic area accounting ($80.3\ \text{m}^2/\text{pixel}$ true geodetic scale at 26.6°N latitude, rather than flat nominal approximations). 

### Dispatch Capture of Annotated Water (Outside Permanent Baseline)
*Source: [`reports/multi_chip_dispatch_benchmark.csv`](file:///c:/Users/aman/Documents/aws-wemake/floodproof/reports/multi_chip_dispatch_benchmark.csv)*

| Top $K$ Sectors Dispatched | Candidate-Water Area Captured (ha) | FloodProof Multi-Criteria % | Predicted Area-Only % | Fixed Threshold % | Simulated Random (200 Seeds) | Analytic Expectation ($K/N$) |
|---|---|---|---|---|---|---|
| **$K = 5$** (7.8% of scene) | 204.6 ha | **31.8%** | **31.8%** | 35.3% | 8.0% ($\pm 3.1\%$) | 7.8% |
| **$K = 10$** (15.6% of scene) | 365.7 ha | **56.8%** | **56.8%** | 62.4% | 15.6% ($\pm 4.2\%$) | 15.6% |
| **$K = 15$** (23.4% of scene) | 461.5 ha | **71.7%** | **71.7%** | 73.7% | 23.3% ($\pm 4.9\%$) | 23.5% |

### Critical Technical Findings:
1. **Mathematical Investigation of Ranking Equality:** The custom multi-criteria formula $(\text{Area} \cdot 0.75 + \text{Ambiguity} \cdot 25.0)$ yielded capture percentages identical to pure predicted-area ordering at top-$K$ thresholds because sector candidate-flood area ranges from 0 to 4,096 pixels, whereas the ambiguity term only varies between 1.3 and 11.4 points. Area naturally dominates the macro ordering.
2. **Defensible Design Decision:** We adopt **Predicted Candidate-Water Area as the primary dispatch ranking**, and use **Model Disagreement as an explicit categorical inspection flag** rather than an arbitrary blended score.
3. **Capture Efficiency:** Inspecting the top 10 sectors (15.6% of geographic area) captures **56.8% of all annotated water**, representing a **3.64x concentration efficiency** over random search.

---

## 4. End-to-End Operator Workflow & AWS Evidence

The operational prototype is implemented in [`src/product/operator_dashboard.py`](file:///c:/Users/aman/Documents/aws-wemake/floodproof/src/product/operator_dashboard.py):

### Verified Workflow on Scene `India_591317` (Assam, India, 2016-08-12):
- **Coverage & Baseline:** 93.9% valid coverage, 690.2 ha of baseline permanent water identified and excluded.
- **Candidate Flood Detection:** 384.7 ha of candidate flood water identified outside rivers.
- **Disagreement Exposed:** 179.3 ha of model disagreement highlighted along the river boundary and agricultural corridors.
- **Triage Manifest Output:**
  ```text
  Rank 1: SEC_34 (36.0 ha candidate flood, 3.2 ha disagreement) -> Priority 2: Inundation Confirmed
  Rank 2: SEC_49 (35.2 ha candidate flood, 10.7 ha disagreement) -> Priority 1: Ground Check Required
  Rank 3: SEC_26 (34.8 ha candidate flood, 1.9 ha disagreement) -> Priority 2: Inundation Confirmed
  ```
- **Human-in-the-Loop Actions:** Operator logged `CONFIRM_DISPATCH` for SEC_34 and `NEEDS_FIELD_CHECK` for SEC_49.
- **AWS S3 Cloud Persistence:** Decisions automatically synced to `s3://floodproof-verification-artifacts-699158992887/audit_logs/operator_decisions_log.csv`.

### Measured Cloud Latency Profile:
- **Feature Preparation:** 20.3 ms
- **Warm Model Inference:** 146.4 ms
- **Triage Queue Post-Processing:** 2.2 ms
- **Total Warm Execution:** **168.8 ms per 5.12 km x 5.12 km scene**
- **RAM Footprint:** ~92.4 MB (Fits natively into AWS Lambda 1024 MB or AWS App Runner container).

---

## 5. Data Provenance & Authoritative Licensing Audit

- **Sentinel-1 SAR Imagery:** Sourced from the European Space Agency Copernicus Programme, governed by the [EU Legal Notice](https://sentinels.copernicus.eu/web/sentinel/terms-conditions) (Open Access, free reuse and redistribution).
- **Human Annotations:** Sen1Floods11 dataset published as Open Access in *CVPRW 2020* (Bonafilia et al.). We openly document that **GitHub Issue #18 remains open**, as the authors omitted a root `LICENSE` file. Academic citations and open research standard terms are preserved.
- **Geographic Attribution:** Georeferenced coordinates for event ID 3 confirmed at **Longitude [92.15°, 94.16°], Latitude [24.85°, 28.29°]**, placing the event in the **Brahmaputra River Basin (Assam, India)**.

---

## 6. Three-Minute Demo Storyboard (Submission Ready)

1. **Minute 0:00 - 0:45 | The Problem:**
   - Introduce monsoon cloud-cover blinding optical satellites in Assam, India.
   - Show how raw flood maps waste emergency rescue resources by treating permanent rivers as flood victims.
2. **Minute 0:45 - 1:45 | FloodProof Pipeline:**
   - Ingest Sentinel-1 SAR imagery (penetrates cloud cover).
   - Run ML inference in 168 ms on CPU.
   - Separate permanent water using JRC global surface water archives.
3. **Minute 1:45 - 2:30 | Operator Triage & Model Disagreement:**
   - Display the interactive dashboard: highlight SEC_49 where the ML model and threshold baseline disagree along an embankment.
   - Show operator assigning ground verification to the ambiguous sector while dispatching immediate aid to high-confidence inundated zones.
4. **Minute 2:30 - 3:00 | Impact & AWS Architecture:**
   - Demonstrate 56.8% flood capture in just 15% of inspection area.
   - Show the persisted audit log in Amazon S3 (`s3://floodproof-verification-artifacts-699158992887/`).
   - Disclose explicit limitations: post-event surface water mapping, not flood depth or road passability.

---

## 7. Reproduction Commands

To reproduce the complete pipeline from scratch:
```powershell
cd c:\Users\aman\Documents\aws-wemake\floodproof
python -m src.evaluation.reconcile_benchmarks
python -m src.product.multi_chip_prioritization
python -m src.evaluation.profile_latency
python -m src.product.operator_dashboard
```
