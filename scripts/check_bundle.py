import urllib.request
import re

html = urllib.request.urlopen('http://44.200.240.31/').read().decode('utf-8')
scripts = re.findall(r'src="(/_next/static/[^"]+)"', html)
print('scripts:', scripts)
idx_list = [s for s in scripts if 'pages/index' in s]
if idx_list:
    idx = idx_list[0]
    js = urllib.request.urlopen('http://44.200.240.31' + idx).read().decode('utf-8')
    print('has fixed_threshold:', 'fixed_threshold' in js)
    print('has Fixed-Threshold:', 'Fixed-Threshold' in js)
else:
    print('No index script found')
