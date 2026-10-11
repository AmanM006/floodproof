# FloodProof 🛰️🌊

> **SAR Satellite Water Analysis, Critical Infrastructure Overlap, and Verifiable Field-Inspection Planning on AWS Cloud**

[![AWS Deployment](https://img.shields.io/badge/AWS-EC2%20%7C%20S3%20%7C%20SSM%20%7C%20IAM-FF9900?logo=amazon-aws&logoColor=white)](http://44.200.240.31/)
[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Python Geospatial](https://img.shields.io/badge/Python-Rasterio%20%7C%20Shapely%20%7C%20XGBoost-3776AB?logo=python&logoColor=white)](https://python.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-green.svg)](LICENSE)

---

## 📌 Executive Summary

During severe flood events, continuous cloud cover renders optical satellites blind. Synthetic Aperture Radar (SAR) from Sentinel-1 penetrates heavy storms and darkness. However, translating raw radar backscatter into an effective operational disaster response presents major challenges:

1. **The Permanent Water Dilemma:** Raw water classification triggers massive false alarms along normal rivers and lakes unless baseline water is systematically distinguished.
2. **Infrastructure Ignorance:** Prioritizing by water area alone sends limited rescue and inspection crews to empty floodplains rather than blocked transport links and stranded villages.
3. **Resource Scarcity:** Emergency response teams cannot inspect hundreds of square kilometers simultaneously. They need **budget-constrained, explainable prioritization**.

**FloodProof** bridges satellite radar analytics and field response. It analyzes Sentinel-1 SAR imagery, masks JRC Global Surface Water baselines, correlates candidate water against OpenStreetMap (OSM) transport and building topologies, and produces prioritized, geo-referenced field inspection plans backed by an auditable Amazon S3 persistence loop.

---

## 🏗️ System Architecture

```text
       [ Sentinel-1 SAR GRD GeoTIFF ]
                     │
                     ▼
┌────────────────────────────────────────────────────────┐
│  AWS EC2 Production Host (Ubuntu 22.04 LTS)            │
│  Public IP: 44.200.240.31                              │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Nginx (Reverse Proxy & Asset Compression)        │  │
│  └─────────────────────────┬────────────────────────┘  │
│                            │                           │
│  ┌─────────────────────────▼────────────────────────┐  │
│  │ Next.js 14 / TypeScript Operator Dashboard       │  │
│  │ - Interactive 64-Sector Evaluation Canvas        │  │
│  │ - Real-time Layer Blending & Opacity Sliders     │  │
│  │ - Budget-Constrained Multi-Criteria Planner      │  │
│  │ - Field Task State Machine & Audit Trail         │  │
│  └─────────────────────────┬────────────────────────┘  │
│                            │                           │
│  ┌─────────────────────────▼────────────────────────┐  │
│  │ Python Geospatial Analytics Pipeline             │  │
│  │ - Lee Speckle Filtering & Log-Ratio Features     │  │
│  │ - JRC Global Surface Water (80%+ Seasonality)    │  │
│  │ - OpenStreetMap Geometry & Hole Subtraction      │  │
│  │ - Haversine Geodetic Metric Metric Math          │  │
│  └─────────────────────────┬────────────────────────┘  │
└────────────────────────────┼───────────────────────────┘
                             │
                             ▼ (IAM Role: floodproof-ec2-role)
┌────────────────────────────────────────────────────────┐
│  Amazon Simple Storage Service (Amazon S3)             │
│  Bucket: s3://floodproof-verification-artifacts-.../   │
│  - Field Verification Logs (`tasks/tasks.json`)        │
│  - Exported GeoJSON / CSV Manifests                    │
│  - Immutable Audit Records                             │
└────────────────────────────────────────────────────────┘
```

---

## ⚡ Core Features

- **Radar Backscatter & Permanent Water Filtering:** Ingests dual-pol ($\text{VV} / \text{VH}$) Sentinel-1 imagery and isolates candidate inundation outside historical JRC baseline channels.
- **Contextual Infrastructure Exposure:** Computes exact meter-level overlaps on OpenStreetMap roads and hectare-level overlaps on building footprints.
- **Model Disagreement as an Active-Learning Feature:** Compares tree-based ML predictions against empirical threshold baselines to pinpoint ambiguity and vegetation attenuation.
- **Budget-Constrained Inspection Planner ($K$):** Generates transparent field queues tailored to available response teams ($K \in [3, 20]$) across multiple selectable objectives:
  - `Infrastructure First`: Targets candidate water intersecting mapped transport corridors and settlements.
  - `Balanced Multi-Criteria`: Weighs candidate inundation, infrastructure impact, and model ambiguity.
  - `Candidate Water Extent`: Area-only prioritization via ML candidate extent.
  - `Fixed-Threshold Area-Only`: Strongest pooled annotated-water baseline.
  - `Model Disagreement`: Focuses field reconnaissance on boundary ambiguities.
- **Field Verification Task State Machine:** Assigns crews, updates dispatch states (`assigned` $\rightarrow$ `in_progress` $\rightarrow$ `field_verified` / `rejected`), records evidence, and prevents overwrite collisions via optimistic version checks.

---

## ☁️ AWS Cloud Implementation

| AWS Component | Implementation Details |
| :--- | :--- |
| **Amazon EC2** | Hosted on an EC2 instance behind Nginx in `us-east-1`. Runs the Next.js runtime and geospatial engine with sub-second response times across 64-sector scene matrices. |
| **Amazon S3** | Persists field verification tasks, audit logs, and exported plans to `s3://floodproof-verification-artifacts-699158992887/`. Updates in real time without downtime. |
| **AWS Systems Manager (SSM)** | Enables automated, zero-downtime continuous deployments and maintenance without exposing port 22 (SSH) to the public internet. |
| **AWS IAM** | Uses an attached EC2 instance profile (`floodproof-ec2-role`) with least-privilege policies. Zero hardcoded access keys exist in code or repository configs. |

---

## 📊 Scientific Evaluation & Qualified Findings

Evaluations were performed across **17 primary historical India scenes** alongside dedicated diagnostic chips:

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

### Core Operational Takeaway & Scientific Scope
> **Qualified Finding:** *On one historical Assam demonstration scene (`India_591317`), selecting 10 of 64 sectors under Infrastructure First captures approximately 69% of predicted mapped-road overlap and 86% of predicted mapped-building overlap.*

- **Contextual Predicted Overlap:** These metrics quantify predicted spatial intersections between satellite backscatter drops and mapped geometries—not confirmed structural damage or flood water depth.
- **Consistent Denominators:** Overlap percentages use consistent, sector-derived denominators ($245.2\text{ m}$ road, $0.28\text{ ha}$ building) that reconcile with overall scene totals within rounding tolerance.
- **Baseline Superiority:** Fixed-Threshold Area-Only remains the strongest pooled annotated-water baseline ($34.54\%$ at $K=10$), demonstrating that FloodProof offers operators an explainable trade-off between pure water coverage and transport exposure.

---

## 📐 Spatial Geometry & Rigor

Spatial invariants are codified in `tests/test_infrastructure_geometry.py`:
1. **Haversine Geodetic Accuracy:** Validated against 1-degree equatorial (111.319 km) and meridian (111.195 km) arcs within $0.05\%$.
2. **Multipolygon Relations with Inner Ring Holes:** OSM `type=multipolygon` relations subtract interior courtyards during rasterization ($10,201\text{ px}$ outer minus $2,601\text{ px}$ inner $\rightarrow 76.0\text{ ha}$ net building footprint).
3. **Sector Boundary Summation:** Disjoint 64-sector summation matches total scene measurements with zero double-counting.
4. **Boundary Clipping:** Out-of-bounds geographic coordinates map cleanly without memory or projection faults.

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ & npm
- Python 3.10+
- AWS CLI configured with appropriate credentials (if deploying)

### 1. Clone & Install Frontend
```bash
git clone https://github.com/AmanM006/floodproof.git
cd floodproof/web
npm install
```

### 2. Run Local Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application.

### 3. Run Geospatial Test Suite
```bash
# Test spatial geometry, geodetics, and OSM hole subtraction
python -m pytest tests/test_infrastructure_geometry.py -v

# Run end-to-end pipeline validation
python -m pytest tests/test_end_to_end.py -k "not test_nextjs and not test_tasks_api" -v
```

---

## 🌐 Live Deployment & Verification Links

- **Production Application:** [http://44.200.240.31/](http://44.200.240.31/)
- **Scenes API:** [http://44.200.240.31/api/scenes](http://44.200.240.31/api/scenes)
- **Field Tasks API:** [http://44.200.240.31/api/tasks](http://44.200.240.31/api/tasks)
- **GitHub Repository:** [https://github.com/AmanM006/floodproof](https://github.com/AmanM006/floodproof)

---

## 📜 License

Distributed under the Apache 2.0 License. See `LICENSE` for details.
