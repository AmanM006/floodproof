import urllib.request
import json
import os

boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
file_path = 'data/raw/S1Hand/India_591317_S1Hand.tif'

with open(file_path, 'rb') as f:
    file_bytes = f.read()

part1 = f'--{boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nFresh Acceptance Run Scene (India_591317)\r\n'.encode('utf-8')
part2 = f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="India_591317_S1Hand.tif"\r\nContent-Type: image/tiff\r\n\r\n'.encode('utf-8')
part3 = f'\r\n--{boundary}--\r\n'.encode('utf-8')

data = part1 + part2 + file_bytes + part3

req = urllib.request.Request(
    'http://localhost:3000/api/infer',
    data=data,
    headers={
        'Content-Type': f'multipart/form-data; boundary={boundary}',
        'Content-Length': str(len(data))
    },
    method='POST'
)

with urllib.request.urlopen(req) as resp:
    res = json.loads(resp.read().decode())
    print('Fresh Upload Status:', res.get('status'))
    print('Input Hash:', res.get('input_hash')[:16])
    print('Cand Water ha:', res.get('total_candidate_water_ha'))
    print('Perm Water ha:', res.get('total_permanent_water_ha'))
    print('Has perm water b64:', 'img_perm_water_b64' in res)
    print('Timings:', res.get('timings'))
    
    compact = dict(res)
    compact['img_sar_b64'] = f"<base64 len={len(res['img_sar_b64'])}>"
    compact['img_cand_water_b64'] = f"<base64 len={len(res['img_cand_water_b64'])}>"
    compact['img_perm_water_b64'] = f"<base64 len={len(res.get('img_perm_water_b64', ''))}>"
    compact['img_disagreement_b64'] = f"<base64 len={len(res['img_disagreement_b64'])}>"
    
    os.makedirs('reports', exist_ok=True)
    with open('reports/fresh_upload_result.json', 'w') as out_f:
        json.dump(compact, out_f, indent=2)
    print('Saved reports/fresh_upload_result.json')
