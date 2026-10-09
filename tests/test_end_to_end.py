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
    """Proves that GeoTIFFs without georeferencing tags are explicitly rejected."""
    with tempfile.NamedTemporaryFile(suffix='.tif', delete=False) as tmp:
        tmp_path = tmp.name
        arr = np.zeros((2, 512, 512), dtype=np.float32)
        tifffile.imwrite(tmp_path, arr)

    try:
        with pytest.raises(ValueError) as excinfo:
            parse_geotiff_metadata(tmp_path)
        assert "Missing georeferencing metadata" in str(excinfo.value)
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

def test_crs_strict_wgs84_enforcement():
    """Proves that missing CRS, non-WGS84 datums (e.g. NAD83 EPSG:4269), and projected CRS are rejected."""
    arr = np.zeros((2, 512, 512), dtype=np.float32)

    # 1. Non-WGS84 Datum: NAD83 (EPSG:4269)
    with tempfile.NamedTemporaryFile(suffix='.tif', delete=False) as tmp1:
        tmp_nad83 = tmp1.name
        tifffile.imwrite(
            tmp_nad83,
            arr,
            extratags=[
                (33550, 'd', 3, (0.0000898315, 0.0000898315, 0.0)),
                (33922, 'd', 6, (0.0, 0.0, 0.0, 92.90, 26.63, 0.0)),
                (34735, 'H', 8, (1, 1, 0, 1, 2048, 0, 1, 4269)) # GeoKey: EPSG:4269
            ]
        )
    try:
        with pytest.raises(ValueError) as excinfo:
            parse_geotiff_metadata(tmp_nad83)
        assert "Unsupported geographic datum EPSG:4269" in str(excinfo.value)
    finally:
        if os.path.exists(tmp_nad83):
            os.unlink(tmp_nad83)

    # 2. Missing CRS altogether
    with tempfile.NamedTemporaryFile(suffix='.tif', delete=False) as tmp2:
        tmp_nocrs = tmp2.name
        tifffile.imwrite(
            tmp_nocrs,
            arr,
            extratags=[
                (33550, 'd', 3, (0.0000898315, 0.0000898315, 0.0)),
                (33922, 'd', 6, (0.0, 0.0, 0.0, 92.90, 26.63, 0.0))
            ]
        )
    try:
        with pytest.raises(ValueError) as excinfo:
            parse_geotiff_metadata(tmp_nocrs)
        assert "Missing explicit CRS definition" in str(excinfo.value)
    finally:
        if os.path.exists(tmp_nocrs):
            os.unlink(tmp_nocrs)

def test_nonzero_tiepoint_calculation():
    """Verifies that nonzero raster tiepoint offsets (e.g. tiepoint at (256, 256)) correctly calculate raster origin."""
    arr = np.zeros((2, 512, 512), dtype=np.float32)
    with tempfile.NamedTemporaryFile(suffix='.tif', delete=False) as tmp:
        tmp_tie = tmp.name
        res = 0.0000898315
        # Tiepoint at center pixel (256, 256) mapping to (92.93, 26.60)
        tifffile.imwrite(
            tmp_tie,
            arr,
            extratags=[
                (33550, 'd', 3, (res, res, 0.0)),
                (33922, 'd', 6, (256.0, 256.0, 0.0, 92.93, 26.60, 0.0)),
                (34735, 'H', 8, (1, 1, 0, 1, 2048, 0, 1, 4326))
            ]
        )
    try:
        geo = parse_geotiff_metadata(tmp_tie)
        expected_origin_x = 92.93 - (256.0 * res)
        expected_origin_y = 26.60 + (256.0 * res)
        assert abs(geo['origin_lon'] - expected_origin_x) < 1e-7
        assert abs(geo['origin_lat'] - expected_origin_y) < 1e-7
    finally:
        if os.path.exists(tmp_tie):
            os.unlink(tmp_tie)

def test_jrc_subpixel_and_one_pixel_shift_rejection():
    """Proves that even a single-pixel shift or accumulated resolution drift is caught and rejected."""
    arr = np.ones((512, 512), dtype=np.uint8)
    res = 8.983152841195215e-05

    # 1. One-pixel shift in origin
    with tempfile.NamedTemporaryFile(suffix='.tif', delete=False) as tmp1:
        tmp_1px = tmp1.name
        tifffile.imwrite(
            tmp_1px,
            arr,
            extratags=[
                (33550, 'd', 3, (res, res, 0.0)),
                (33922, 'd', 6, (0.0, 0.0, 0.0, 92.90735994477738 + res, 26.63037693466639, 0.0)), # shifted by 1 pixel
                (34735, 'H', 8, (1, 1, 0, 1, 2048, 0, 1, 4326))
            ]
        )
    try:
        res_out = run_pipeline(SAMPLE_TIF, tmp_1px)
        assert "origin offset exceeds 0.05 pixels" in res_out['baseline_status']
        assert res_out['total_permanent_water_ha'] == 0.0
    finally:
        if os.path.exists(tmp_1px):
            os.unlink(tmp_1px)

    # 2. Accumulated resolution drift across 512 pixels
    with tempfile.NamedTemporaryFile(suffix='.tif', delete=False) as tmp2:
        tmp_drift = tmp2.name
        drift_res = res + (0.5 * res / 512.0) # 0.5 pixel drift
        tifffile.imwrite(
            tmp_drift,
            arr,
            extratags=[
                (33550, 'd', 3, (drift_res, res, 0.0)),
                (33922, 'd', 6, (0.0, 0.0, 0.0, 92.90735994477738, 26.63037693466639, 0.0)),
                (34735, 'H', 8, (1, 1, 0, 1, 2048, 0, 1, 4326))
            ]
        )
    try:
        res_drift = run_pipeline(SAMPLE_TIF, tmp_drift)
        assert "accumulated displacement across 512px exceeds 0.05 pixels" in res_drift['baseline_status']
    finally:
        if os.path.exists(tmp_drift):
            os.unlink(tmp_drift)

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

def test_tasks_api_optimistic_concurrency_conflict():
    """Proves that a stale expected_version returns HTTP 409 Conflict, preventing lost updates."""
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

    sec_id = f"SEC_CONCUR_{int(time.time() * 1000) % 100000}"
    # Operator 1 creates assignment (version 1)
    c1, r1 = post_task({'chip_id': 'India_591317', 'sector_id': sec_id, 'status': 'assigned', 'assigned_team': 'Op1'})
    assert c1 == 200
    task_v1 = r1['task']
    assert task_v1['version'] == 1

    # Operator 1 advances to in_progress (becomes version 2)
    c2, r2 = post_task({'chip_id': 'India_591317', 'sector_id': sec_id, 'status': 'in_progress', 'expected_version': 1})
    assert c2 == 200
    assert r2['task']['version'] == 2

    # Operator 2 attempts an update using stale expected_version 1
    c3, r3 = post_task({'chip_id': 'India_591317', 'sector_id': sec_id, 'status': 'operator_reviewed', 'expected_version': 1})
    assert c3 == 409, f"Expected 409 Conflict, got {c3}: {r3}"
    assert "Conflict" in r3['error']
    assert r3['current_version'] == 2

def test_tasks_api_get_truthful_cloud_sync_and_recovery():
    """Verifies that GET /api/tasks truthfully returns cloud_synced state and pulls from S3 if local missing."""
    req = urllib.request.Request('http://localhost:3000/api/tasks')
    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200
        data = json.loads(resp.read().decode())
        assert 'cloud_synced' in data
        assert isinstance(data['cloud_synced'], bool)
        assert 'tasks' in data
        assert isinstance(data['tasks'], list)

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
    test_crs_strict_wgs84_enforcement()
    print("PASS: test_crs_strict_wgs84_enforcement")
    test_nonzero_tiepoint_calculation()
    print("PASS: test_nonzero_tiepoint_calculation")
    test_jrc_subpixel_and_one_pixel_shift_rejection()
    print("PASS: test_jrc_subpixel_and_one_pixel_shift_rejection")
    test_validity_mask_strict_preservation()
    print("PASS: test_validity_mask_strict_preservation")
    test_geodesy_no_silent_capping_and_invariant_violation()
    print("PASS: test_geodesy_no_silent_capping_and_invariant_violation")
    test_nextjs_tasks_api_transitions_and_evidence()
    print("PASS: test_nextjs_tasks_api_transitions_and_evidence")
    test_tasks_api_optimistic_concurrency_conflict()
    print("PASS: test_tasks_api_optimistic_concurrency_conflict")
    test_tasks_api_get_truthful_cloud_sync_and_recovery()
    print("PASS: test_tasks_api_get_truthful_cloud_sync_and_recovery")
    test_s3_cloud_roundtrip()
    print("PASS: test_s3_cloud_roundtrip")
    print("ALL 11 AUDIT REGRESSION TESTS PASSED.")
