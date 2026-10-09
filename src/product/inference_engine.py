"""
CLI Runner for FloodProof On-Demand Inference.
Outputs full JSON including b64 images or writes directly to file.
"""

import sys
import os
import json

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

from src.product.shared_pipeline import run_pipeline

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: python inference_engine.py <path_to_s1_tif> [scene_name] [out_json_path] [jrc_tif_path]'}))
        sys.exit(1)
        
    s1_tif = sys.argv[1]
    name = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != 'null' else None
    out_path = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != 'null' else None
    jrc_tif = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] != 'null' else None
    
    try:
        res = run_pipeline(s1_tif, jrc_tif_path=jrc_tif, scene_name=name)
        if out_path:
            with open(out_path, 'w') as f:
                json.dump(res, f)
            print(json.dumps({'success': True, 'out_path': out_path, 'metadata': res['metadata']}))
        else:
            print(json.dumps(res))
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)
