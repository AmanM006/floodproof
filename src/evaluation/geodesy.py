"""
Geodetic and Geographic Calculator for FloodProof.

Provides mathematically unified area calculations using WGS84 ellipsoidal geometry:
- WGS84 Semi-major axis a = 6378137.0 m
- Reciprocal flattening 1/f = 298.257223563
- Exact Meridional (M) and Prime Vertical (N) radii of curvature.
- Invariant Enforcer: Candidate water area in any sector CANNOT exceed the valid sector area.
"""

import numpy as np

def get_geodetic_pixel_dimensions(lat_deg: float, dx_deg: float = 8.983152841195215e-05, dy_deg: float = 8.983152841195215e-05):
    """
    Computes exact ground dimensions (meters) of a pixel on the WGS84 ellipsoid.
    """
    a = 6378137.0
    f = 1.0 / 298.257223563
    e2 = 2.0 * f - f**2
    lat_rad = np.radians(lat_deg)

    M = a * (1.0 - e2) / ((1.0 - e2 * np.sin(lat_rad)**2)**1.5)
    N = a / np.sqrt(1.0 - e2 * np.sin(lat_rad)**2)

    dy_m = dy_deg * np.radians(1.0) * M
    dx_m = dx_deg * np.radians(1.0) * N * np.cos(lat_rad)
    pixel_area_m2 = dx_m * dy_m
    pixel_area_ha = pixel_area_m2 / 10000.0

    return {
        'dx_m': dx_m,
        'dy_m': dy_m,
        'pixel_area_m2': pixel_area_m2,
        'pixel_area_ha': pixel_area_ha
    }

def compute_sector_areas(valid_pixels_count: int, candidate_water_pixels_count: int, lat_deg: float):
    """
    Computes sector valid area and candidate water area with strict invariant enforcement.
    """
    geom = get_geodetic_pixel_dimensions(lat_deg)
    px_ha = geom['pixel_area_ha']

    sector_valid_ha = round(valid_pixels_count * px_ha, 4)
    cand_water_ha = round(candidate_water_pixels_count * px_ha, 4)

    # Invariant: candidate water cannot exceed valid sector area
    if candidate_water_pixels_count > valid_pixels_count or cand_water_ha > sector_valid_ha:
        raise ValueError(
            f"Geodetic Invariant Violation: Candidate water ({cand_water_ha} ha, {candidate_water_pixels_count} px) "
            f"exceeds valid sector area ({sector_valid_ha} ha, {valid_pixels_count} px)."
        )

    return {
        'pixel_area_m2': float(geom['pixel_area_m2']),
        'pixel_area_ha': float(px_ha),
        'sector_valid_ha': float(sector_valid_ha),
        'candidate_water_ha': float(cand_water_ha),
        'invariant_passed': True
    }

if __name__ == '__main__':
    res = compute_sector_areas(4096, 4000, 26.63)
    print("Sample Sector Geodetic Area:", res)
    assert res['invariant_passed'], "Geographic invariant violated!"
