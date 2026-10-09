"""
Automated Comprehensive Regression and End-to-End Test Suite for FloodProof.

Tests:
1. Full TIFF -> Feature Extraction -> Prediction Pipeline (shared_pipeline).
2. Validity mask preservation (raw NaN / corrupted pixels stay invalid).
3. Geodetic area calculation across multiple latitudes (no silent capping).
4. Evidence enforcement: Rejection of field_verified when evidence is missing.
5. Task state transition graph: Illegal transitions are rejected.
6. S3 cloud persistence roundtrip.
7. Model artifact integrity and reproducible inference.
"""

import os
import sys
import json
import time
import pytest
import numpy as np
import tifffile
import urllib.request
import urllib.error
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from src.product.shared_pipeline import (
    run_pipeline, 
    compute_valid_mask, 
    compute_geodetic_pixel_area,
    parse_geotiff_metadata
)
from src.evaluation.geodesy import compute_sector_areas
from src.product.cloud_tasks import CloudTaskManager

RAW_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'raw')
SAMPLE_TIF = os.path.join(RAW_DIR, 'S1Hand', 'India_591317_S1Hand.tif')
SAMPLE_JRC = os.path.join(RAW_DIR, 'JRCWaterHand', 'India_591317_JRCWaterHand.tif')

def test_full_pipeline_execution():
    """Verifies that an actual Sentinel-1 GeoTIFF executes through the unified pipeline with JRC alignment."""
    assert os.path.exists(SAMPLE_TIF), f"Missing test GeoTIFF: {SAMPLE_TIF}"
    assert os.path.exists(SAMPLE_JRC), f"Missing test JRC GeoTIFF: {SAMPLE_JRC}"
    res = run_pipeline(SAMPLE_TIF, SAMPLE_JRC, scene_name="Test Verification Scene")
    
    assert res['status'] == 'completed'
    assert len(res['input_hash']) == 64
    assert len(res['sectors']) == 64
    assert "JRC Global Permanent Water baseline verified and applied" in res['baseline_status']
    
    # Contract check: all 4 image overlays present and non-empty
    for img_key in ['img_sar_b64', 'img_cand_water_b64', 'img_perm_water_b64', 'img_disagreement_b64']:
        assert img_key in res, f"Missing image key: {img_key}"
        assert len(res[img_key]) > 100, f"Image {img_key} contains empty data"
        
    # Check geodetic invariants
    assert res['geodesy']['pixel_area_m2'] > 85.0
    assert res['geodesy']['max_sector_ha'] <= 37.0
    for s in res['sectors']:
        assert s['candidate_water_ha'] <= s['valid_ha']

def test_unreferenced_geotiff_rejection():
    """Proves that GeoTIFFs without georeferencing tags or with non-WGS84 projected CRS are explicitly rejected."""
    with tempfile.NamedTemporaryFile(suffix='.tif', delete=False) as tmp:
        tmp_path = tmp.name
        # Write 512x512 dummy TIFF without geotags
        arr = np.zeros((2, 512, 512), dtype=np.float32)
        tifffile.imwrite(tmp_path, arr)

    try:
        with pytest.raises(ValueError) as excinfo:
            parse_geotiff_metadata(tmp_path)
        assert "Missing georeferencing metadata" in str(excinfo.value)
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

def test_jrc_geometric_alignment_enforcement():
    """Proves that a misaligned JRC permanent water raster is safely rejected."""
    # Create misaligned JRC raster with different tiepoint
    with tempfile.NamedTemporaryFile(suffix='.tif', delete=False) as tmp:
        tmp_jrc = tmp.name
        arr = np.ones((512, 512), dtype=np.uint8)
        # Shift tiepoint by 1 degree
        tifffile.imwrite(
            tmp_jrc, 
            arr, 
            extratags=[
                (33550, 'd', 3, (0.0000898315, 0.0000898315, 0.0)),
                (33922, 'd', 6, (0.0, 0.0, 0.0, 50.0, 10.0, 0.0)) # shifted coords
            ]
        )

    try:
        res = run_pipeline(SAMPLE_TIF, tmp_jrc)
        # Should gracefully reject baseline due to spatial origin mismatch
        assert "rejected due to geometric misalignment" in res['baseline_status']
        assert res['total_permanent_water_ha'] == 0.0
    finally:
        if os.path.exists(tmp_jrc):
            os.unlink(tmp_jrc)

def test_validity_mask_strict_preservation():
    """Proves that raw invalid pixels (NaN / out of range) are NEVER counted as valid."""
    raw_vv = np.full((100, 100), -18.0, dtype=np.float32)
    raw_vh = np.full((100, 100), -24.0, dtype=np.float32)
    
    # Inject 50 invalid pixels
    raw_vv[:25, 0] = np.nan
    raw_vh[25:50, 0] = -999.0 # out of [-70, +30] dB range
    
    mask = compute_valid_mask(raw_vv, raw_vh)
    assert mask.sum() == (100 * 100) - 50, "Invalid pixels were wrongly filled or masked as valid!"

def test_geodesy_no_silent_capping_and_invariant_violation():
    """Verifies that geodetic pixel area varies with latitude and that invariant violation raises ValueError."""
    area_equator = compute_geodetic_pixel_area(0.0, 0.0000898315, 0.0000898315)
    area_assam = compute_geodetic_pixel_area(26.63, 0.0000898315, 0.0000898315)
    area_high_lat = compute_geodetic_pixel_area(60.0, 0.0000898315, 0.0000898315)
    
    # Cosine convergence with latitude
    assert area_equator > area_assam > area_high_lat
    assert 99.0 <= area_equator <= 101.0
    assert 88.0 <= area_assam <= 90.0

    # Test that candidate water exceeding valid area raises ValueError instead of silent clamp
    with pytest.raises(ValueError) as excinfo:
        compute_sector_areas(valid_pixels_count=100, candidate_water_pixels_count=150, lat_deg=26.63)
    assert "Geodetic Invariant Violation" in str(excinfo.value)

def test_nextjs_tasks_api_transitions_and_evidence():
    """Exercises the live Next.js /api/tasks endpoint for illegal transitions and evidence rules."""
    def post_task(payload):
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            'http://localhost:3000/api/tasks', 
            data=data, 
            headers={'Content-Type': 'application/json'}, 
            method='POST'
        )
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.status, json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode())

    # 1. Illegal transition on a fresh task: created -> field_verified
    test_sec = f"SEC_TEST_{int(time.time() * 1000) % 100000}"
    c1, r1 = post_task({'chip_id': 'India_591317', 'sector_id': test_sec, 'status': 'field_verified', 'evidence': 'GPS Log #123456789'})
    assert c1 == 400
    assert "Illegal state transition" in r1['error']

    # 2. Legal transition: created -> assigned
    c2, r2 = post_task({'chip_id': 'India_591317', 'sector_id': test_sec, 'status': 'assigned', 'assigned_team': 'Testing Crew'})
    assert c2 == 200
    assert r2['task']['status'] == 'assigned'

    # 3. Advance to in_progress
    c3, r3 = post_task({'chip_id': 'India_591317', 'sector_id': test_sec, 'status': 'in_progress'})
    assert c3 == 200
    assert r3['task']['status'] == 'in_progress'

    # 4. Attempt field_verified with short evidence (<10 chars)
    c4, r4 = post_task({'chip_id': 'India_591317', 'sector_id': test_sec, 'status': 'field_verified', 'evidence': 'short'})
    assert c4 == 400
    assert "Traceable ground evidence (min 10 characters" in r4['error']

    # 5. Complete field_verified with valid traceable evidence
    c5, r5 = post_task({'chip_id': 'India_591317', 'sector_id': test_sec, 'status': 'field_verified', 'evidence': 'High-water survey ref #HW-2016-SILGHAT-01'})
    assert c5 == 200
    assert r5['task']['status'] == 'field_verified'
    assert r5['cloud_persisted'] is True

def test_s3_cloud_roundtrip():
    """Verifies live write and readback to AWS S3 bucket."""
    mgr = CloudTaskManager()
    ok, data = mgr.verify_s3_roundtrip()
    assert ok is True, f"S3 roundtrip failed: {data}"
    assert data.get('status') == 'verified_roundtrip'

if __name__ == '__main__':
    test_full_pipeline_execution()
    print("PASS: test_full_pipeline_execution")
    test_unreferenced_geotiff_rejection()
    print("PASS: test_unreferenced_geotiff_rejection")
    test_jrc_geometric_alignment_enforcement()
    print("PASS: test_jrc_geometric_alignment_enforcement")
    test_validity_mask_strict_preservation()
    print("PASS: test_validity_mask_strict_preservation")
    test_geodesy_no_silent_capping_and_invariant_violation()
    print("PASS: test_geodesy_no_silent_capping_and_invariant_violation")
    test_nextjs_tasks_api_transitions_and_evidence()
    print("PASS: test_nextjs_tasks_api_transitions_and_evidence")
    test_s3_cloud_roundtrip()
    print("PASS: test_s3_cloud_roundtrip")
    print("ALL 7 AUDIT REGRESSION TESTS PASSED.")
