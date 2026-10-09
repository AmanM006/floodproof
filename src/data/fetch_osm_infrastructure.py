import urllib.request
import json
import os

url = 'https://overpass-api.de/api/interpreter'
query = """
[out:json][timeout:25];
(
  node["place"~"town|village|hamlet"](26.58,92.85,26.68,92.96);
  way["highway"~"primary|secondary|tertiary|residential"](26.58,92.85,26.68,92.96);
);
out body;
>;
out skel qt;
"""

os.makedirs('data/raw', exist_ok=True)
req = urllib.request.Request(url, data=query.encode('utf-8'), headers={'User-Agent': 'FloodProof-Research/1.0'})
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        elements = data.get('elements', [])
        print(f"OSM elements retrieved: {len(elements)}")
        places = [e for e in elements if 'tags' in e and 'place' in e['tags']]
        roads = [e for e in elements if 'tags' in e and 'highway' in e['tags']]
        print(f"Settlements: {len(places)} | Road ways: {len(roads)}")
        out_path = 'data/raw/osm_assam_infrastructure.json'
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        print(f"Saved real OSM layer to {out_path}")
except Exception as e:
    print(f"OSM fetch error: {e}")
