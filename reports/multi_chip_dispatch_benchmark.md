# Multi-Chip Verification Dispatch Benchmark Summary

This benchmark records the percentage of annotated candidate-flood water (outside permanent baseline) captured by dispatching field teams to the top-$k$ prioritized sectors across 7 test scenes (447 eligible sectors total).

## Benchmark Methodology & Corrections
- **Diagnostic Quarantine:** Scene `India_900498` is an acknowledged diagnostic training chip and is analyzed separately from fresh held-out evaluation chips.
- **Pooled vs. Mean Metrics:** 
  - **Mean per-chip capture (top 10 sectors):** **56.8%** across all 7 chips (and **60.1%** across the 6 strictly held-out chips).
  - **Pooled area capture (top 10 sectors):** **41.45%** (1,040.26 ha captured out of 2,509.79 ha total annotated candidate water).
  - In comparison, equal-allocation uniform random sampling captures **15.6%** ($15.6\% \pm 7.1\%$).
- **Baseline Comparator:** Fixed backscatter thresholding captures a higher pooled area (**62.4%**) in low-vegetation wetlands, confirming that model predictions must serve as candidate prioritization alerts rather than autonomous dispatch decisions.
- **Geodetic Area Correction:** All sector extents are calculated using WGS84 ellipsoidal scaling ($89.03\text{ m}^2/\text{px}$ at 26.63°N in Assam; $90.21\text{ m}^2/\text{px}$ in Paraguay).

| Scene ID | Event Region | Total Sectors | Total Annotated Candidate Water (ha) | Top 10 Sectors Captured (ha) | FloodProof Capture % | Fixed Threshold % | Random Expected % |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **India_900498** *(Diagnostic)* | Assam, India | 64 | 715.56 | 263.33 | 36.8% | 37.0% | 15.6% |
| **India_591317** | Assam, India | 64 | 374.52 | 251.30 | 67.1% | 67.1% | 15.6% |
| **India_747992** | Assam, India | 64 | 1,173.22 | 363.70 | 31.0% | 27.3% | 15.6% |
| **India_828067** | Assam, India | 63 | 65.31 | 49.05 | 75.1% | 75.4% | 15.9% |
| **Paraguay_913449** | Paraguay River | 64 | 55.04 | 36.88 | 67.0% | 83.8% | 15.6% |
| **Paraguay_280900** | Paraguay River | 64 | 63.33 | 32.17 | 50.8% | 74.8% | 15.6% |
| **Paraguay_790830** | Paraguay River | 64 | 62.81 | 43.84 | 69.8% | 71.5% | 15.6% |
| **Mean per-chip (All 7)** | — | — | — | — | **56.8%** | **62.4%** | **15.6%** |
| **Mean per-chip (6 Held-Out)**| — | — | — | — | **60.1%** | **66.6%** | **15.6%** |
| **Pooled Total Across Chips** | — | **447** | **2,509.79 ha** | **1,040.26 ha** | **41.45%** | — | — |
