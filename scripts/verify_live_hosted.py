import requests
import re

print("Testing live deployment at http://44.200.240.31...")
r = requests.get('http://44.200.240.31/', timeout=10)
print("Homepage HTTP status:", r.status_code)

scripts = re.findall(r'src="(/_next/static/chunks/[^"]+)"', r.text)
print("Found scripts:", len(scripts))

matched_terms = set()
for s in scripts:
    url = f"http://44.200.240.31{s}"
    text = requests.get(url, timeout=10).text
    for term in [
        "Inspection Planning", 
        "Budget K", 
        "CONTEXTUAL INFRASTRUCTURE EXPOSURE", 
        "Mapped Roads (OSM)",
        "Building Footprints (OSM)"
    ]:
        if term in text:
            matched_terms.add(term)

print("Matched live frontend terms:", list(matched_terms))

# Check scenes API
r_scenes = requests.get('http://44.200.240.31/api/scenes', timeout=10)
print("/api/scenes HTTP status:", r_scenes.status_code)
scenes_data = r_scenes.json()
sc = scenes_data.get('India_591317', {})
print("India_591317 in API:", bool(sc))
print("Infrastructure in scene:", bool(sc.get('infrastructure')))
print("Inspection plan in scene:", bool(sc.get('inspection_plan')))
if sc.get('infrastructure'):
    print("Roads km:", sc['infrastructure']['scene_summary']['total_road_km'])
    print("Buildings count:", sc['infrastructure']['scene_summary']['total_buildings_count'])
    print("Overlapping road km:", sc['infrastructure']['scene_summary']['overlapping_road_km'])
if sc.get('inspection_plan'):
    print("Plan budget K:", sc['inspection_plan']['summary']['budget_k'])
    print("Top sectors in plan:", [s['id'] for s in sc['inspection_plan']['top_sectors'][:3]])
    print("Common with area baseline:", sc['inspection_plan']['summary']['comparison_with_area_baseline']['common_sectors_count'])
