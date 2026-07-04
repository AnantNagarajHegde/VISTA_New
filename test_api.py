import urllib.request, json
req = urllib.request.Request(
    'http://localhost:8000/api/case/create',
    method='POST',
    data=b'{"name": "Test", "investigator": "Test"}',
    headers={'Content-Type': 'application/json'}
)
try:
    res = urllib.request.urlopen(req)
    print("Create Case:", res.read().decode('utf-8'))
except Exception as e:
    print("Create Case Error:", e)
