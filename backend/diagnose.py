"""
Quick test: restart analysis with new analyzer on running server data.
"""
import json, urllib.request, sys

BASE = "http://localhost:8000/api"

# Force re-analysis by hitting the demo endpoint again
print("Re-loading demo case to clear cache...")
try:
    resp = urllib.request.urlopen(urllib.request.Request(f"{BASE}/case/demo", method="POST"), timeout=300)
    data = json.loads(resp.read())
    print(f"Loaded: {data.get('files_processed')} files, {data.get('total_transactions')} txns")
except Exception as e:
    print(f"Error loading demo: {e}")
    sys.exit(1)

print("\nFetching analysis (this runs the new analyzer)...")
try:
    resp = urllib.request.urlopen(f"{BASE}/case/demo/analysis", timeout=300)
    analysis = json.loads(resp.read())
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)

summary = analysis.get("summary", {})
print(f"\n=== Summary ===")
for k, v in summary.items():
    if k != "top_flows":
        print(f"  {k}: {v}")

rts = analysis.get("round_trips", [])
print(f"\n=== Round Trips: {len(rts)} ===")
for i, rt in enumerate(rts[:10]):
    path_str = " -> ".join(rt["cycle_path"])
    print(f"  #{i+1} [{rt['risk_score']}] {path_str}")
    print(f"       Total: Rs.{rt['total_amount']:,.0f}  Hops: {rt['num_hops']}  Dates: {rt['date_range']}")
    for hop in rt.get("hops", []):
        print(f"       {hop['from'][:15]} -> {hop['to'][:15]}  Rs.{hop['amount']:,.0f} ({hop['count']} txns) [{hop.get('method','')}]")
    print()

flows = analysis.get("fund_flow_summary", [])
print(f"\n=== Fund Flows: {len(flows)} pairs ===")
for ff in flows[:15]:
    print(f"  {ff['source'][:18]:18s} -> {ff['destination'][:18]:18s}  Rs.{ff['total_amount']:>12,.0f}  cnt={ff['transaction_count']}  [{ff.get('method','')}]")

suspicious = analysis.get("suspicious_accounts", [])
print(f"\n=== Suspicious Accounts: {len(suspicious)} ===")
for sa in suspicious[:10]:
    print(f"  {sa['account_id'][:20]:20s} [{sa['risk_level']:8s}] in=Rs.{sa['total_in']:>12,.0f} out=Rs.{sa['total_out']:>12,.0f}")
    for r in sa["reasons"]:
        print(f"    - {r}")

print("\nDONE")
