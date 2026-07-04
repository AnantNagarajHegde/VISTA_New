import json
import urllib.request

try:
    resp = urllib.request.urlopen("http://localhost:8000/api/case/demo/analysis")
    data = json.loads(resp.read())
    
    print(f"Summary fund flows: {len(data.get('fund_flow_summary', []))}")
    print(f"Summary round trips: {len(data.get('round_trips', []))}")
    
    for i, rt in enumerate(data.get('round_trips', [])[:5]):
        print(f"#{i+1}: {' -> '.join(rt['cycle_path'])} (Rs. {rt['total_amount']})")
        
except Exception as e:
    print(f"Error: {e}")
