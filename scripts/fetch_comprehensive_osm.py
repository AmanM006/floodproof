import urllib.request
import json
import os

url = 'https://overpass-api.de/api/interpreter'
query = """
[out:json][timeout:35];
(
  node["place"~"town|village|hamlet"](26.58,92.85,26.68,92.96);
  way["highway"~"primary|secondary|tertiary|residential|unclassified|track|trunk"](26.58,92.85,26.68,92.96);
  node["amenity"~"hospital|clinic|school|college|police|shelter|pharmacy|doctors"](26.58,92.85,26.68,92.96);
  way["amenity"~"hospital|clinic|school|college|police|shelter|pharmacy|doctors"](26.58,92.85,26.68,92.96);
  way["building"](26.58,92.85,26.68,92.96);
);
out body;
>;
out skel qt;
"""

os.makedirs('data/raw', exist_ok=True)
req = urllib.request.Request(url, data=query.encode('utf-8'), headers={'User-Agent': 'FloodProof-Research/1.0'})
try:
    print("Querying Overpass API for Assam bounding box (26.58-26.68 N, 92.85-92.96 E)...")
    with urllib.request.urlopen(req, timeout=40) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        elems = data.get('elements', [])
        print(f"Total elements retrieved: {len(elems)}")
        places = [e for e in elems if 'tags' in e and 'place' in e['tags']]
        roads = [e for e in elems if 'tags' in e and 'highway' in e['tags']]
        amenities = [e for e in elems if 'tags' in e and 'amenity' in e['tags']]
        buildings = [e for e in elems if 'tags' in e and 'building' in e['tags']]
        print(f"Places: {len(places)} | Roads: {len(roads)} | Amenities: {len(amenities)} | Buildings: {len(buildings)}")
        
        for a in amenities:
            print("  Amenity:", a.get('tags', {}).get('name', 'Unnamed'), a.get('tags', {}).get('amenity'))

        out_path = 'data/raw/osm_assam_infrastructure_comprehensive.json'
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        print(f"Saved comprehensive OSM data to {out_path}")
except Exception as e:
    print(f"Fetch error: {e}")
