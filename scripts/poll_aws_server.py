import urllib.request
import json
import time
import sys

host = '44.200.240.31'
url = f'http://{host}:3000/api/tasks'
print(f'Checking live AWS endpoint {url}...')

for attempt in range(1, 35):
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            print(f'SUCCESS at attempt {attempt}! Connected to live AWS deployment.')
            tasks_list = data.get('tasks', []) if isinstance(data, dict) else data
            print(f'Tasks count: {len(tasks_list)}, cloud_synced: {data.get("cloud_synced")}')
            sys.exit(0)
    except Exception as e:
        print(f'Attempt {attempt}: Waiting for server setup... ({e})')
        time.sleep(10)

print('Timeout waiting for instance')
sys.exit(1)
