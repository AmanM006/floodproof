"""
CLI Runner for FloodProof On-Demand Inference.
Outputs full JSON including b64 images or writes directly to file.
"""

import sys
import os
import json
from src.product.shared_pipeline import run_pipeline

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: python inference_engine.py <path_to_s1_tif> [scene_name] [out_json_path]'}))
        sys.exit(1)
        
    s1_tif = sys.argv[1]
    name = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != 'null' else None
    out_path = sys.argv[3] if len(sys.argv) > 3 else None
    
    try:
        res = run_pipeline(s1_tif, scene_name=name)
        if out_path:
            with open(out_path, 'w') as f:
                json.dump(res, f)
            print(json.dumps({'success': True, 'out_path': out_path, 'metadata': res['metadata']}))
        else:
            print(json.dumps(res))
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)
