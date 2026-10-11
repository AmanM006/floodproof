# FloodProof 🛰️🌊

> **SAR Satellite Water Analysis, Contextual Infrastructure Exposure, and Explainable Inspection Planning on AWS**

[![AWS Deployment](https://img.shields.io/badge/AWS-EC2%20%7C%20S3%20%7C%20SSM%20%7C%20IAM-FF9900?logo=amazon-aws&logoColor=white)](http://44.200.240.31/)
[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.12%20%7C%20tifffile%20%7C%20scipy%20%7C%20XGBoost-3776AB?logo=python&logoColor=white)](https://python.org/)

---

## 📌 Overview & Scope

During major flood disasters, continuous cloud cover renders optical satellites blind. Synthetic Aperture Radar (SAR) from Sentinel-1 penetrates storms and cloud decks by recording microwave backscatter.

However, turning satellite radar observations into actionable disaster management requires solving three operational challenges:
1. **Distinguishing Permanent Water:** Rivers and perennial reservoirs must be separated from new surface water so emergency teams are not sent to inspect ordinary waterways.
2. **Contextual Infrastructure Exposure:** Large rural water bodies do not necessarily correlate with human exposure. Response coordinators need spatial intersections with transport networks and settlements.
3. **Capacity Constraints:** Ground reconnaissance resources are strictly limited. Teams need **budget-constrained, explainable prioritization**.

**FloodProof** provides an operator workspace for investigating satellite-detected surface water outside historical permanent water baselines, inspecting contextual OpenStreetMap (OSM) infrastructure intersections, and generating explainable inspection queues.

> **Operational Scope & Limitations:**
> - Water identified outside the permanent baseline represents **candidate inundation**, not ground-confirmed flooding or measured depth.
> - Overlaps with OpenStreetMap features represent **contextual potential exposure**, not confirmed physical damage or impassable roads.
> - Field verification workflows and status updates shown in the demonstration are **simulated workflows**.
> - Quantitative infrastructure overlap benchmarks reflect **one historical Assam demonstration scene**.

---

## 🏗️ System Architecture

```text
       [ Sentinel-1 SAR GRD GeoTIFF ]
                     │
                     ▼
┌────────────────────────────────────────────────────────┐
│  AWS EC2 Production Host                               │
│  Ubuntu 24.04 LTS (Noble) • Public IP: 44.200.240.31   │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Nginx Reverse Proxy                              │  │
│  └─────────────────────────┬────────────────────────┘  │
│                            │                           │
│  ┌─────────────────────────▼────────────────────────┐  │
│  │ Next.js 14 / TypeScript Operator Dashboard       │  │
│  │ - 64-Sector Interactive Canvas (8x8 Grid)        │  │
│  │ - Dynamic Layer Blending & Opacity Sliders       │  │
│  │ - Multi-Criteria Sector Budget Planner (K)       │  │
│  │ - Field Task State Machine (HTTP 409 Conflict)   │  │
│  └─────────────────────────┬────────────────────────┘  │
│                            │                           │
│  ┌─────────────────────────▼────────────────────────┐  │
│  │ Python Geospatial Processing (execFile)          │  │
│  │ - Preprocessed SAR backscatter in dB             │  │
│  │ - 3x3 Spatial Box Mean & Variance Features       │  │
│  │ - JRC Permanent Water Baseline Filtering         │  │
│  │ - OpenStreetMap Geometry & Hole Subtraction      │  │
│  │ - Haversine Geodetic Metric Calculations         │  │
│  └─────────────────────────┬────────────────────────┘  │
└────────────────────────────┼───────────────────────────┘
                             │
                             ▼ (IAM Instance Role: floodproof-ec2-role)
┌────────────────────────────────────────────────────────┐
│  Amazon Simple Storage Service (Amazon S3)             │
│  Bucket: floodproof-verification-artifacts-...         │
│  - Object: tasks/verification_tasks.json               │
│  - Remote recovery on application startup             │
│  - Client-side export for GeoJSON / CSV plans          │
└────────────────────────────────────────────────────────┘
```

---

## ⚡ Core Capabilities

- **Backscatter Analysis & Permanent Water Baseline:** Ingests dual-polarization ($\text{VV} / \text{VH}$) Sentinel-1 imagery and isolates candidate water outside historical permanent water masks (JRC Global Surface Water).
- **Contextual Infrastructure Exposure:** Computes raster-derived estimates of mapped-road overlap (meters) and building footprints (hectares) from OpenStreetMap.
- **Model-Disagreement Inspection:** Compares machine-learning water predictions against empirical fixed-threshold baselines to identify areas of ambiguity for targeted inspection.
- **Budget-Constrained Inspection Planner ($K$):** Evaluates an operator budget parameter ($K \in [3, 20]$) across the 64-sector grid, allowing operators to choose transparent operational trade-offs:
  - `Infrastructure First`: Targets candidate water intersecting mapped transport corridors and settlements.
  - `Balanced Multi-Criteria`: Combines candidate water extent, infrastructure exposure, and model ambiguity.
  - `Candidate Water Extent (XGBoost)`: Area-only prioritization based on ML candidate water.
  - `Fixed-Threshold Area-Only`: Strongest pooled annotated-water baseline.
  - `Model Disagreement`: Focuses reconnaissance on boundary ambiguity between models.
- **Field Verification State Machine:** Manages simulated task dispatch (`assigned` $\rightarrow$ `in_progress` $\rightarrow$ `field_verified` / `rejected`) with optimistic version checks (HTTP 409 Conflict) and S3 persistence recovery.

---

## ☁️ AWS Cloud Implementation

- **Amazon EC2:** Hosted on an Amazon EC2 instance running Ubuntu 24.04 LTS in `us-east-1` behind Nginx. Internal sector task state queries resolve in <50 ms on-host.
- **Amazon S3:** Persists simulated verification task records to `s3://floodproof-verification-artifacts-699158992887/tasks/verification_tasks.json`. If local storage is absent, the API recovers state from this S3 object.
- **AWS Systems Manager (SSM):** Environment updates and software deployments are executed via SSM Run Command, avoiding the need for an open inbound SSH port (port 22).
- **AWS IAM:** The EC2 host authenticates to Amazon S3 using an attached IAM instance profile (`floodproof-ec2-role`) without stored access keys in configuration files.

---

## 📊 Scientific Evaluation & Operational Findings

Evaluations were conducted across **17 primary historical India scenes** alongside dedicated diagnostic chips.

### Pooled Annotated-Water Capture ($K = 10$)
*Target evaluated is annotated water (`label == 1` within valid data bounds, including permanent baseline).*

| Strategy | Pooled Annotated Water Captured (%) | Pooled Road Overlap Captured (%)* | Pooled Building Overlap Captured (%)* | Pooled Disagreement Captured (%) |
| :--- | :---: | :---: | :---: | :---: |
| **Fixed-Threshold Area-Only (Baseline)** | **34.54%** | 0.00% | 0.00% | 28.56% |
| **XGBoost Area-Only (Baseline)** | 31.14% | 0.00% | 0.00% | 37.39% |
| **Planner Infra-First (Targeted)** | 30.36% | **69.25%** | **85.71%** | 36.86% |
| **Planner Balanced (Multi-Criteria)** | 29.89% | **69.25%** | 60.71% | 38.80% |
| **Planner Conflict-First** | 26.00% | 0.00% | 7.14% | **41.36%** |
| **Random Selection (Analytic Expected)** | 15.62% | 15.62% | 15.64% | 15.62% |

### Core Operational Trade-off & Scope
> **Qualified Demonstration Finding:** *On one historical Assam demonstration scene (`India_591317`), selecting 10 of 64 sectors under Infrastructure First captures approximately 69% of predicted mapped-road overlap and 86% of predicted mapped-building overlap.*

- **Strongest Water Baseline:** `Fixed-Threshold Area-Only` captures the highest pooled annotated-water volume across all budgets ($34.54\%$ at $K=10$), demonstrating that FloodProof provides operators with an explicit, selectable trade-off between total water area and contextual infrastructure exposure.
- **Demonstration Context:** Mapped OpenStreetMap infrastructure was benchmarked on one historical demonstration scene (`India_591317`). Overlaps are raster-derived estimates, not confirmed damage.
- **Consistent Denominators:** Percentages are computed from consistent sector-derived denominators ($245.2\text{ m}$ road overlap, $0.28\text{ ha}$ building overlap) reconciling with scene totals within rounding tolerance.

---

## 📐 Spatial Geometry & Test Suite

Spatial calculations are verified in `tests/test_infrastructure_geometry.py`:
1. **Haversine Geodetics:** Validates spherical distance against 1-degree equatorial (~111.3 km) and meridian (~111.1 km) distances.
2. **Multipolygon Relations with Inner Ring Holes:** OSM `type=multipolygon` relations subtract interior courtyards during rasterization ($10,201\text{ px}$ outer minus $2,601\text{ px}$ inner $\rightarrow 76.0\text{ ha}$ net footprint).
3. **Sector Boundary Summation:** Sum of disjoint 64-sector measurements reconciles with total scene measurements without double-counting.
4. **Boundary Clipping:** Out-of-bounds geographic coordinates clip to valid bounds without exceptions.

---

## 🚀 Setup & Execution Guide

### Prerequisites
- Node.js 18+ & npm
- Python 3.10+ (tested on Python 3.12)
- Git

### 1. Clone & Set Up Python Environment
```bash
git clone https://github.com/AmanM006/floodproof.git
cd floodproof

# Create and activate Python virtual environment
python -m venv venv
# On Windows:
.\venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

# Install Python geospatial dependencies
pip install -r requirements.txt
```

### 2. Run Geospatial Invariant & Geometry Tests
```bash
# Execute from the repository root
python -m pytest tests/test_infrastructure_geometry.py -v
python -m pytest tests/test_end_to_end.py -k "not test_nextjs and not test_tasks_api" -v
```

### 3. Install & Run Next.js Operator Dashboard
```bash
cd web
npm install
npm run build
npm run start
```
Open [http://localhost:3000](http://localhost:3000) to view the application.

---

## 🌐 Live Application Links

- **Hosted Application:** [http://44.200.240.31/](http://44.200.240.31/)
- **Scenes API:** [http://44.200.240.31/api/scenes](http://44.200.240.31/api/scenes)
- **Tasks API:** [http://44.200.240.31/api/tasks](http://44.200.240.31/api/tasks)
- **GitHub Repository:** [https://github.com/AmanM006/floodproof](https://github.com/AmanM006/floodproof)

---

## 📄 Provenance & Attribution

- **Sentinel-1 SAR Data:** European Space Agency (ESA) Copernicus Sentinel-1 radar data via the open-access Sen1Floods11 benchmark dataset.
- **Permanent Water Mask:** European Commission Joint Research Centre (JRC) Global Surface Water dataset.
- **Infrastructure Topologies:** © OpenStreetMap contributors, licensed under the Open Database License (ODbL).
- **Assisted Development:** Built with pair-programming assistance from Antigravity (Google DeepMind).
