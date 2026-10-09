"""
Spatial Infrastructure Exposure Module for FloodProof.

Computes geometric intersection between detected candidate flood water
and real OpenStreetMap features (roads, buildings, settlements).

Methodology:
1. Load comprehensive OSM extract (data/raw/osm_assam_infrastructure_comprehensive.json).
2. Transform WGS84 nodes to raster pixel coordinates using affine geotransform.
3. Rasterize roads using LineStrings (Bresenham / line rasterization, nominal 1 px ~ 10m).
4. Rasterize building footprints using closed polygons.
5. Overlay against candidate water mask (and permanent baseline).
6. Calculate:
   - Total road length (km) in scene and length overlapping candidate water (km).
   - Total building footprint area (ha) and area overlapping candidate water (ha).
   - Per-sector exposure metrics (road m overlapping, building ha overlapping, village names).
7. Attach explicit coverage disclaimers and OSM attribution.
"""

import os
import json
import math
from typing import Dict, Any, List, Tuple
import numpy as np
import cv2

DEFAULT_OSM_PATH = os.path.join(
    os.path.dirname(__file__), '..', '..', 'data', 'raw', 'osm_assam_infrastructure_comprehensive.json'
)

def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Computes great-circle distance between two WGS84 coordinates in meters."""
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0)**2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


def load_osm_data(osm_path: str = DEFAULT_OSM_PATH) -> Dict[str, Any]:
    """Loads OSM json extract if available."""
    if not os.path.exists(osm_path):
        return {"elements": []}
    with open(osm_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def analyze_infrastructure_exposure(
    cand_water_mask: np.ndarray,
    perm_water_mask: np.ndarray,
    geo_meta: Dict[str, Any],
    pixel_area_m2: float,
    osm_path: str = DEFAULT_OSM_PATH
) -> Dict[str, Any]:
    """
    Computes spatial infrastructure exposure metrics and raster overlays.
    
    Parameters:
    - cand_water_mask: 512x512 boolean array of candidate flood water.
    - perm_water_mask: 512x512 boolean array of permanent water baseline.
    - geo_meta: Geotransform metadata dict (origin_lon, origin_lat, res_deg_x, res_deg_y).
    - pixel_area_m2: Geodetic pixel area in m^2.
    - osm_path: Path to OSM comprehensive JSON.
    
    Returns:
    - Dict containing scene-wide exposure totals, per-sector metrics, and rendered RGBA overlays.
    """
    H, W = cand_water_mask.shape
    ha_per_px = pixel_area_m2 / 10000.0
    
    osm_data = load_osm_data(osm_path)
    elements = osm_data.get('elements', [])
    
    nodes = {e['id']: (e['lon'], e['lat']) for e in elements if e.get('type') == 'node'}
    ways = [e for e in elements if e.get('type') == 'way']
    places = [e for e in elements if e.get('type') == 'node' and 'place' in e.get('tags', {})]
    
    origin_lon = geo_meta['origin_lon']
    origin_lat = geo_meta['origin_lat']
    res_x = geo_meta['res_deg_x']
    res_y = geo_meta['res_deg_y']
    
    def lonlat_to_rc(lon: float, lat: float) -> Tuple[float, float]:
        col = (lon - origin_lon) / res_x
        row = (origin_lat - lat) / res_y
        return row, col

    # Bounding box of scene
    min_lon = origin_lon
    max_lon = origin_lon + W * res_x
    min_lat = origin_lat - H * res_y
    max_lat = origin_lat

    # 1. Rasterize Roads and Calculate Lengths
    road_mask = np.zeros((H, W), dtype=np.uint8)
    road_overlap_mask = np.zeros((H, W), dtype=np.uint8)
    
    total_road_length_m = 0.0
    overlapping_road_length_m = 0.0
    scene_roads_count = 0
    
    road_features = []
    for way in ways:
        tags = way.get('tags', {})
        if 'highway' not in tags:
            continue
        
        way_node_ids = way.get('nodes', [])
        way_coords = [nodes[nid] for nid in way_node_ids if nid in nodes]
        if len(way_coords) < 2:
            continue
        
        # Check if any point is in or near scene bounding box
        if not any(min_lon - 0.01 <= c[0] <= max_lon + 0.01 and min_lat - 0.01 <= c[1] <= max_lat + 0.01 for c in way_coords):
            continue
            
        scene_roads_count += 1
        way_road_type = tags.get('highway', 'road')
        way_name = tags.get('name', 'Unnamed Road')
        
        # Trace line segments
        way_len_m = 0.0
        way_overlap_m = 0.0
        
        for i in range(len(way_coords) - 1):
            p1_lon, p1_lat = way_coords[i]
            p2_lon, p2_lat = way_coords[i+1]
            seg_len = haversine_m(p1_lon, p1_lat, p2_lon, p2_lat)
            
            r1, c1 = lonlat_to_rc(p1_lon, p1_lat)
            r2, c2 = lonlat_to_rc(p2_lon, p2_lat)
            
            # Draw segment on a temporary line raster to find pixel overlap
            line_canvas = np.zeros((H, W), dtype=np.uint8)
            cv2.line(line_canvas, (int(round(c1)), int(round(r1))), (int(round(c2)), int(round(r2))), 1, thickness=1)
            
            num_line_pixels = int(np.sum(line_canvas))
            if num_line_pixels > 0:
                road_mask = np.maximum(road_mask, line_canvas)
                # Overlap with candidate flood water
                overlap_pixels = int(np.sum((line_canvas == 1) & cand_water_mask))
                overlap_ratio = overlap_pixels / float(num_line_pixels)
                
                way_len_m += seg_len
                way_overlap_m += seg_len * overlap_ratio
                
                if overlap_pixels > 0:
                    road_overlap_mask = np.maximum(road_overlap_mask, (line_canvas == 1) & cand_water_mask)
        
        total_road_length_m += way_len_m
        overlapping_road_length_m += way_overlap_m
        if way_len_m > 0:
            road_features.append({
                'id': way.get('id'),
                'name': way_name,
                'type': way_road_type,
                'length_m': round(way_len_m, 1),
                'overlap_m': round(way_overlap_m, 1)
            })

    # 2. Rasterize Buildings and Calculate Areas
    building_mask = np.zeros((H, W), dtype=np.uint8)
    total_building_footprint_ha = 0.0
    overlapping_building_footprint_ha = 0.0
    scene_buildings_count = 0
    overlapping_buildings_count = 0

    for way in ways:
        tags = way.get('tags', {})
        if 'building' not in tags:
            continue
        
        way_node_ids = way.get('nodes', [])
        way_coords = [nodes[nid] for nid in way_node_ids if nid in nodes]
        if len(way_coords) < 3:
            continue
        
        # Check bounding box
        if not any(min_lon <= c[0] <= max_lon and min_lat <= c[1] <= max_lat for c in way_coords):
            continue
            
        scene_buildings_count += 1
        poly_pts = []
        for lon, lat in way_coords:
            r, c = lonlat_to_rc(lon, lat)
            poly_pts.append([int(round(c)), int(round(r))])
        
        poly_np = np.array([poly_pts], dtype=np.int32)
        b_canvas = np.zeros((H, W), dtype=np.uint8)
        cv2.fillPoly(b_canvas, poly_np, 1)
        
        b_px = int(np.sum(b_canvas))
        if b_px > 0:
            building_mask = np.maximum(building_mask, b_canvas)
            b_overlap_px = int(np.sum((b_canvas == 1) & cand_water_mask))
            b_ha = b_px * ha_per_px
            total_building_footprint_ha += b_ha
            if b_overlap_px > 0:
                overlapping_buildings_count += 1
                overlapping_building_footprint_ha += (b_overlap_px * ha_per_px)

    building_overlap_mask = (building_mask == 1) & cand_water_mask

    # 3. Identify Named Settlements / Places inside scene
    settlements = []
    for p in places:
        plon, plat = p['lon'], p['lat']
        r, c = lonlat_to_rc(plon, plat)
        if 0 <= r < H and 0 <= c < W:
            s_row = int(r // 64)
            s_col = int(c // 64)
            sec_id = f"SEC_{s_row * 8 + s_col + 1:02d}"
            settlements.append({
                'name': p.get('tags', {}).get('name', 'Settlement'),
                'type': p.get('tags', {}).get('place', 'village'),
                'lat': round(plat, 5),
                'lon': round(plon, 5),
                'row': int(round(r)),
                'col': int(round(c)),
                'sector_id': sec_id
            })

    # 4. Compute Per-Sector Infrastructure Metrics
    sector_infra = {}
    for r_idx in range(8):
        for c_idx in range(8):
            sec_idx = r_idx * 8 + c_idx + 1
            sec_id = f"SEC_{sec_idx:02d}"
            r_start, r_end = r_idx * 64, (r_idx + 1) * 64
            c_start, c_end = c_idx * 64, (c_idx + 1) * 64
            
            s_cand = cand_water_mask[r_start:r_end, c_start:c_end]
            s_road = road_mask[r_start:r_end, c_start:c_end]
            s_road_overlap = road_overlap_mask[r_start:r_end, c_start:c_end]
            s_bld = building_mask[r_start:r_end, c_start:c_end]
            s_bld_overlap = building_overlap_mask[r_start:r_end, c_start:c_end]
            
            # Approximate road meters in sector
            road_px = int(np.sum(s_road))
            road_overlap_px = int(np.sum(s_road_overlap))
            # 1 pixel is ~ 10m
            px_linear_m = math.sqrt(pixel_area_m2)
            s_road_m = round(road_px * px_linear_m, 1)
            s_road_overlap_m = round(road_overlap_px * px_linear_m, 1)
            
            s_bld_ha = round(float(np.sum(s_bld) * ha_per_px), 2)
            s_bld_overlap_ha = round(float(np.sum(s_bld_overlap) * ha_per_px), 2)
            
            s_settlements = [st['name'] for st in settlements if st['sector_id'] == sec_id]
            
            sector_infra[sec_id] = {
                'sector_id': sec_id,
                'road_length_m': s_road_m,
                'road_overlap_m': s_road_overlap_m,
                'building_ha': s_bld_ha,
                'building_overlap_ha': s_bld_overlap_ha,
                'settlements': s_settlements,
                'has_exposure': (s_road_overlap_m > 0 or s_bld_overlap_ha > 0)
            }

    # 5. Render Transparent RGBA Infrastructure PNGs
    # Roads RGBA: Bright orange [1.0, 0.55, 0.0, 0.90] for mapped roads
    # Road overlap RGBA: Vibrant red-orange [1.0, 0.2, 0.0, 1.0]
    roads_rgba = np.zeros((H, W, 4), dtype=np.float32)
    roads_rgba[road_mask == 1] = [1.0, 0.65, 0.0, 0.85]
    roads_rgba[road_overlap_mask == 1] = [0.95, 0.15, 0.1, 0.95]

    # Buildings RGBA: Lavender-violet [0.75, 0.5, 0.9, 0.80] for mapped buildings
    # Building overlap RGBA: Deep magenta [0.85, 0.0, 0.5, 0.95]
    bld_rgba = np.zeros((H, W, 4), dtype=np.float32)
    bld_rgba[building_mask == 1] = [0.70, 0.55, 0.90, 0.80]
    bld_rgba[building_overlap_mask == 1] = [0.90, 0.10, 0.55, 0.95]

    return {
        'source': 'OpenStreetMap (Comprehensive Overpass Query)',
        'data_disclaimer': 'Contextual potential exposure based on mapped OSM features. Absence of mapped features does not indicate absence of infrastructure.',
        'scene_summary': {
            'total_roads_count': scene_roads_count,
            'total_road_km': round(total_road_length_m / 1000.0, 2),
            'overlapping_road_km': round(overlapping_road_length_m / 1000.0, 2),
            'total_buildings_count': scene_buildings_count,
            'overlapping_buildings_count': overlapping_buildings_count,
            'total_building_footprint_ha': round(total_building_footprint_ha, 2),
            'overlapping_building_footprint_ha': round(overlapping_building_footprint_ha, 2),
            'settlements': settlements
        },
        'sector_infrastructure': sector_infra,
        'roads_rgba': roads_rgba,
        'buildings_rgba': bld_rgba
    }
