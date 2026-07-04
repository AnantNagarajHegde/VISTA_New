"""
VISTA Fraud Analysis Engine v2.

Key change from v1: Instead of relying on counterparty account extraction
from garbled narrations (which produces 82K phantom "accounts" from
IMPS/NEFT/RTGS reference numbers), we use **amount+date correlation**
to link primary accounts.

Algorithm: If Account A debits ₹X on date D, and Account B credits ₹X
on date D (±1 day), that's evidence of a transfer A→B. We aggregate
these matches to build a reliable inter-account graph, then run cycle
detection on it.
"""

from __future__ import annotations

import os
import re
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _money(value) -> float:
    """Coerce to float, default 0.0."""
    try:
        v = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    if v != v:  # NaN check
        return 0.0
    return round(v, 2)


def _parse_date(d) -> Optional[datetime]:
    """Parse a date string into a datetime object."""
    if not d:
        return None
    if isinstance(d, datetime):
        return d
    try:
        return datetime.strptime(str(d).strip(), "%Y-%m-%d")
    except (ValueError, TypeError):
        return None


def _owner_account_map(transactions: list[dict]) -> dict[str, str]:
    """Map source_file -> owner account number.

    Strategy:
    1. If the file's transactions have an explicit ``account_no`` column, use it.
    2. Try to extract a plausible account number from the filename.
    3. Fall back to the filename stem itself.
    """
    file_to_account: dict[str, str] = {}
    # Pass 1: from column data
    for txn in transactions:
        sf = (txn.get("source_file") or "").strip()
        acc = (txn.get("account_no") or "").strip()
        if sf and acc and sf not in file_to_account:
            file_to_account[sf] = acc

    # Pass 2: fall back to filename-derived ID
    for txn in transactions:
        sf = (txn.get("source_file") or "").strip()
        if not sf or sf in file_to_account:
            continue
        base = os.path.splitext(os.path.basename(sf))[0]
        digit_match = re.search(r"\d{8,18}", base)
        if digit_match:
            file_to_account[sf] = digit_match.group(0)
        else:
            file_to_account[sf] = base

    return file_to_account


def _extract_beneficiary_account(narration: str) -> Optional[str]:
    """Extract beneficiary account from specific narration patterns.
    
    Only extracts from high-confidence patterns like:
    - BLKNEFT/OnscreenPayment/{account_no}
    - BLKRTGS/OnscreenPayment/{account_no}
    
    Deliberately AVOIDS extracting from:
    - IMPS/{reference_number}/...  (these are IMPS refs, not accounts)
    - RTGS/{UTR}/...  (these are UTR numbers)
    - UPI/MOB/{reference}/...  (UPI transaction refs)
    - NEFT/{reference}/...  (NEFT refs)
    """
    if not narration:
        return None
    text = narration.upper()
    
    # OnscreenPayment patterns contain actual beneficiary account numbers
    match = re.search(r'ONSCREENPAYMENT/(\d{8,18})', text)
    if match:
        return match.group(1)
    
    return None


# ---------------------------------------------------------------------------
# 1. Build account graph using amount+date correlation
# ---------------------------------------------------------------------------

def build_account_graph(transactions: list[dict]) -> dict:
    """Build a directed weighted graph of money movement between primary accounts.

    Uses TWO strategies:
    1. Amount+Date correlation: Match debits in account A to credits in 
       account B by amount (exact or ±2%) and date (±1 day).
    2. Beneficiary extraction: Parse known patterns from narrations.
    
    Returns::

        {
            "nodes": {account_id: {id, total_in, total_out, tx_count, files}},
            "edges": {(src, dst): {amount, count, dates, method}},
            "owner_map": {source_file: account_id},
        }
    """
    owner_map = _owner_account_map(transactions)
    
    # Group transactions by owner account
    by_owner: dict[str, list[dict]] = defaultdict(list)
    for txn in transactions:
        sf = (txn.get("source_file") or "").strip()
        owner = owner_map.get(sf)
        if owner:
            by_owner[owner].append(txn)
    
    # Build node stats
    nodes: dict[str, dict] = {}
    for acc_id, txn_list in by_owner.items():
        total_in = sum(_money(t.get("credit")) for t in txn_list)
        total_out = sum(_money(t.get("debit")) for t in txn_list)
        files = set(t.get("source_file", "") for t in txn_list)
        nodes[acc_id] = {
            "id": acc_id,
            "total_in": round(total_in, 2),
            "total_out": round(total_out, 2),
            "tx_count": len(txn_list),
            "files": sorted(files),
            "is_primary": True,
        }
    
    edges: dict[str, dict] = {}
    primary_ids = list(by_owner.keys())
    
    # --- Strategy 1: Amount+Date Correlation ---
    # For each primary account, index credits by (date, amount)
    # Then for each other account's debits, look for matches
    
    # Build credit index: {account_id: [(date_obj, amount, txn), ...]}
    credit_index: dict[str, list[tuple]] = {}
    for acc_id in primary_ids:
        credits = []
        for txn in by_owner[acc_id]:
            credit = _money(txn.get("credit"))
            if credit <= 0:
                continue
            date_obj = _parse_date(txn.get("date"))
            if date_obj:
                credits.append((date_obj, credit, txn))
        credits.sort(key=lambda x: (x[0], x[1]))
        credit_index[acc_id] = credits
    
    # For each pair (A, B) where A != B, match A's debits to B's credits
    global_used_credits: dict[str, set[int]] = defaultdict(set)
    global_used_debits: dict[str, set[int]] = defaultdict(set)
    
    for src_id in primary_ids:
        src_debits = []
        for txn in by_owner[src_id]:
            debit = _money(txn.get("debit"))
            if debit <= 100:  # Skip tiny amounts (fees, charges)
                continue
            date_obj = _parse_date(txn.get("date"))
            if date_obj:
                src_debits.append((date_obj, debit, txn))
        
        if not src_debits:
            continue
        
        for dst_id in primary_ids:
            if src_id == dst_id:
                continue
            
            dst_credits = credit_index.get(dst_id, [])
            if not dst_credits:
                continue
            
            matched_amount = 0.0
            matched_count = 0
            matched_dates = []
            matched_txns = []
            
            for d_idx, (d_date, d_amt, d_txn) in enumerate(src_debits):
                if d_idx in global_used_debits[src_id]:
                    continue
                    
                # Look for matching credit in dst within ±1 day and ±2% amount
                
                # Binary search / two pointer optimization to find the start index
                # Since we want c_date >= d_date - 1 day
                start_c_idx = 0
                import bisect
                start_c_idx = bisect.bisect_left(dst_credits, (d_date - timedelta(days=1), 0.0, None))
                
                for c_idx in range(start_c_idx, len(dst_credits)):
                    c_date, c_amt, c_txn = dst_credits[c_idx]
                    
                    if c_idx in global_used_credits[dst_id]:
                        continue
                    
                    # Date proximity check
                    if (c_date - d_date).days > 1:
                        break  # Credits are sorted, no point looking further
                    
                    if abs((d_date - c_date).days) > 1:
                        continue
                    
                    # Amount match check (exact for amounts < 50K, ±2% for larger)
                    if d_amt < 50000:
                        if abs(d_amt - c_amt) > 1.0:
                            continue
                    else:
                        tolerance = d_amt * 0.02
                        if abs(d_amt - c_amt) > tolerance:
                            continue
                    
                    # Match found!
                    matched_amount += d_amt
                    matched_count += 1
                    global_used_credits[dst_id].add(c_idx)
                    global_used_debits[src_id].add(d_idx)
                    date_str = d_date.strftime("%Y-%m-%d")
                    matched_dates.append(date_str)
                    matched_txns.append({
                        "date": date_str,
                        "amount": round(d_amt, 2),
                        "narration": d_txn.get("narration", "")
                    })
                    break
            
            if matched_count >= 1 and matched_amount >= 1000:
                edge_key = f"{src_id}|{dst_id}"
                edges[edge_key] = {
                    "amount": round(matched_amount, 2),
                    "count": matched_count,
                    "dates": sorted(set(matched_dates)),
                    "matched_txns": matched_txns,
                    "method": "amount_date_correlation",
                }
    
    # --- Strategy 2: Beneficiary account extraction from narrations ---
    owner_set = set(primary_ids)
    
    for src_id in primary_ids:
        for txn in by_owner[src_id]:
            debit = _money(txn.get("debit"))
            if debit <= 0:
                continue
            
            narration = txn.get("narration") or ""
            beneficiary = _extract_beneficiary_account(narration)
            
            if beneficiary and beneficiary in owner_set and beneficiary != src_id:
                edge_key = f"{src_id}|{beneficiary}"
                if edge_key not in edges:
                    edges[edge_key] = {
                        "amount": 0.0,
                        "count": 0,
                        "dates": [],
                        "matched_txns": [],
                        "method": "narration_extraction",
                    }
                edges[edge_key]["amount"] = round(edges[edge_key]["amount"] + debit, 2)
                edges[edge_key]["count"] += 1
                date_str = txn.get("date") or ""
                edges[edge_key]["matched_txns"].append({
                    "date": date_str,
                    "amount": round(debit, 2),
                    "narration": txn.get("narration", "")
                })
                if date_str:
                    edges[edge_key]["dates"].append(date_str)
    
    # Ensure all nodes referenced by edges exist
    for key in edges:
        src, dst = key.split("|", 1)
        if src not in nodes:
            nodes[src] = {
                "id": src, "total_in": 0.0, "total_out": 0.0,
                "tx_count": 0, "files": [], "is_primary": src in owner_set,
            }
        if dst not in nodes:
            nodes[dst] = {
                "id": dst, "total_in": 0.0, "total_out": 0.0,
                "tx_count": 0, "files": [], "is_primary": dst in owner_set,
            }
    
    return {
        "nodes": nodes,
        "edges": edges,
        "owner_map": owner_map,
    }


# ---------------------------------------------------------------------------
# 2. Round-trip (cycle) detection
# ---------------------------------------------------------------------------

def detect_round_trips(
    graph: dict,
    min_amount: float = 100000.0,
    max_depth: int = 3,
) -> list[dict]:
    """Detect circular money movement (A → B → … → A).

    Uses iterative DFS from every node, up to *max_depth* hops.
    Only reports cycles where every edge carries ≥ *min_amount*.
    """
    edges_raw = graph["edges"]
    nodes = graph["nodes"]

    # Build adjacency list
    adj: dict[str, list[tuple[str, float, int, str, str]]] = defaultdict(list)
    for key_str, edata in edges_raw.items():
        src, dst = key_str.split("|", 1)
        if edata["amount"] < min_amount:
            continue
        dates = sorted(edata["dates"]) if edata["dates"] else []
        date_min = dates[0] if dates else ""
        date_max = dates[-1] if dates else ""
        adj[src].append((dst, edata["amount"], edata["count"], date_min, date_max))

    all_node_ids = list(nodes.keys())
    found_cycles: list[tuple[tuple[str, ...], float]] = []
    seen_cycle_keys: set[frozenset[str]] = set()

    for start in all_node_ids:
        if not adj.get(start):
            continue
            
        # DFS stack: (current_node, path, min_edge_amount, total_amount)
        stack: list[tuple[str, list[str], float, float]] = [
            (start, [start], float("inf"), 0.0)
        ]
        visited_from_start: set[tuple[str, ...]] = set()

        while stack:
            current, path, min_edge, total_amt = stack.pop()

            for neighbor, edge_amt, _cnt, _dmin, _dmax in adj.get(current, []):
                new_min = min(min_edge, edge_amt)
                new_total = total_amt + edge_amt

                if neighbor == start and len(path) >= 2:
                    # Found a cycle! (minimum 2 hops: A→B→A)
                    cycle_path = tuple(path)
                    cycle_key = frozenset(path)
                    if cycle_key not in seen_cycle_keys:
                        seen_cycle_keys.add(cycle_key)
                        found_cycles.append((cycle_path, new_total))
                    continue

                if neighbor in path:
                    continue

                if len(path) >= max_depth:
                    continue

                path_tuple = tuple(path + [neighbor])
                if path_tuple in visited_from_start:
                    continue
                visited_from_start.add(path_tuple)

                stack.append((neighbor, path + [neighbor], new_min, new_total))

    # Enrich results
    results: list[dict] = []
    for cycle_path, total_amount in found_cycles:
        hops = []
        for i in range(len(cycle_path)):
            src = cycle_path[i]
            dst = cycle_path[(i + 1) % len(cycle_path)]
            edge_key = f"{src}|{dst}"
            edata = edges_raw.get(edge_key, {})
            dates = sorted(edata.get("dates", []))
            hops.append({
                "from": src,
                "to": dst,
                "amount": edata.get("amount", 0),
                "count": edata.get("count", 0),
                "date_range": f"{dates[0]} to {dates[-1]}" if len(dates) >= 2 else (dates[0] if dates else ""),
                "method": edata.get("method", ""),
            })

        all_dates = []
        for h in hops:
            dr = h.get("date_range", "")
            if " to " in dr:
                parts = dr.split(" to ")
                all_dates.extend(parts)
            elif dr:
                all_dates.append(dr)
        all_dates = sorted(set(d for d in all_dates if d))

        results.append({
            "cycle_path": list(cycle_path) + [cycle_path[0]],
            "num_hops": len(cycle_path),
            "total_amount": round(total_amount, 2),
            "min_edge_amount": round(min(h["amount"] for h in hops) if hops else 0, 2),
            "hops": hops,
            "date_range": f"{all_dates[0]} to {all_dates[-1]}" if len(all_dates) >= 2 else (all_dates[0] if all_dates else ""),
            "risk_score": _cycle_risk_score(cycle_path, hops, nodes),
        })

    results.sort(key=lambda c: c["total_amount"], reverse=True)
    return results[:500]


def _cycle_risk_score(path, hops, nodes) -> str:
    total = sum(h["amount"] for h in hops)
    num_hops = len(path)
    if total > 500_000 and num_hops >= 3:
        return "CRITICAL"
    if total > 100_000 or num_hops >= 4:
        return "HIGH"
    if total > 10_000:
        return "MEDIUM"
    return "LOW"


# ---------------------------------------------------------------------------
# 3. Money Trail (FIFO)
# ---------------------------------------------------------------------------

def compute_money_trail(
    transactions: list[dict],
    max_trails: int = 50,
) -> list[dict]:
    """For each significant credit, track where the money went via FIFO."""
    owner_map = _owner_account_map(transactions)

    by_account: dict[str, list[dict]] = defaultdict(list)
    for txn in transactions:
        sf = (txn.get("source_file") or "").strip()
        owner = owner_map.get(sf)
        if owner:
            by_account[owner].append(txn)

    for acc in by_account:
        by_account[acc].sort(key=lambda t: t.get("date") or "")

    trails: list[dict] = []

    for account_id, txn_list in by_account.items():
        for i, txn in enumerate(txn_list):
            credit = _money(txn.get("credit"))
            if credit < 5000:
                continue

            remaining = credit
            destinations: list[dict] = []

            for j in range(i + 1, len(txn_list)):
                if remaining <= 0:
                    break
                subsequent = txn_list[j]
                debit = _money(subsequent.get("debit"))
                if debit <= 0:
                    continue

                amount_used = min(debit, remaining)
                remaining = round(remaining - amount_used, 2)

                beneficiary = _extract_beneficiary_account(subsequent.get("narration"))
                destinations.append({
                    "date": subsequent.get("date"),
                    "narration": (subsequent.get("narration") or "")[:120],
                    "amount": amount_used,
                    "destination": beneficiary or "Unknown",
                    "source_file": subsequent.get("source_file") or "",
                })

            if destinations:
                credit_source = _extract_beneficiary_account(txn.get("narration"))
                trails.append({
                    "account": account_id,
                    "credit_date": txn.get("date"),
                    "credit_amount": credit,
                    "credit_narration": (txn.get("narration") or "")[:120],
                    "credit_source": credit_source or "Unknown",
                    "amount_traced": round(credit - remaining, 2),
                    "amount_untraced": remaining,
                    "destinations": destinations[:10],  # Cap destinations per trail
                })

            if len(trails) >= max_trails:
                break
        if len(trails) >= max_trails:
            break

    trails.sort(key=lambda t: t["credit_amount"], reverse=True)
    return trails


# ---------------------------------------------------------------------------
# 4. Fund Flow Summary
# ---------------------------------------------------------------------------

def compute_fund_flow_summary(graph: dict) -> list[dict]:
    """Convert graph edges into a sorted fund flow summary table.
    
    Uses the graph built by build_account_graph (which already uses
    amount+date correlation), rather than re-scanning all transactions.
    """
    edges = graph["edges"]
    results = []
    
    for key_str, edata in edges.items():
        src, dst = key_str.split("|", 1)
        dates = sorted(edata.get("dates", []))
        results.append({
            "source": src,
            "destination": dst,
            "total_amount": edata["amount"],
            "transaction_count": edata["count"],
            "date_range": f"{dates[0]} to {dates[-1]}" if len(dates) >= 2 else (dates[0] if dates else ""),
            "method": edata.get("method", ""),
        })

    results.sort(key=lambda r: r["total_amount"], reverse=True)
    return results


# ---------------------------------------------------------------------------
# 5. Suspicious Account Detection
# ---------------------------------------------------------------------------

def detect_suspicious_accounts(
    graph: dict,
    round_trips: list[dict],
) -> list[dict]:
    """Flag accounts exhibiting suspicious behavior."""
    nodes = graph["nodes"]
    edges_raw = graph["edges"]

    # Collect cycle membership
    cycle_members: dict[str, int] = defaultdict(int)
    for rt in round_trips:
        for acc in rt["cycle_path"]:
            cycle_members[acc] += 1

    # Fan-in / fan-out
    fan_out: dict[str, set[str]] = defaultdict(set)
    fan_in: dict[str, set[str]] = defaultdict(set)
    for key_str in edges_raw:
        src, dst = key_str.split("|", 1)
        fan_out[src].add(dst)
        fan_in[dst].add(src)

    results: list[dict] = []
    for acc_id, nd in nodes.items():
        total_in = nd.get("total_in", 0)
        total_out = nd.get("total_out", 0)
        total_vol = total_in + total_out
        tx_count = nd.get("tx_count", 0)

        reasons: list[str] = []
        risk_score = 0

        # Cycle membership (highest priority)
        if acc_id in cycle_members:
            reasons.append(f"In {cycle_members[acc_id]} round-trip cycle(s)")
            risk_score += 5

        # Pass-through detection
        if total_in > 10000 and total_out > 10000:
            ratio = min(total_in, total_out) / max(total_in, total_out)
            if ratio > 0.6:
                reasons.append(f"Pass-through (in/out ratio {ratio:.0%})")
                risk_score += 3

        # High fan-out
        out_count = len(fan_out.get(acc_id, set()))
        if out_count >= 3:
            reasons.append(f"Sends to {out_count} accounts")
            risk_score += 2

        # High fan-in
        in_count = len(fan_in.get(acc_id, set()))
        if in_count >= 3:
            reasons.append(f"Receives from {in_count} accounts")
            risk_score += 2

        # High volume
        if total_vol > 500_000:
            reasons.append(f"High volume (Rs.{total_vol:,.0f})")
            risk_score += 1

        if not reasons:
            continue

        risk_label = "CRITICAL" if risk_score >= 8 else "HIGH" if risk_score >= 5 else "MEDIUM" if risk_score >= 3 else "LOW"

        results.append({
            "account_id": acc_id,
            "is_primary": nd.get("is_primary", False),
            "total_in": total_in,
            "total_out": total_out,
            "net_flow": round(total_in - total_out, 2),
            "tx_count": tx_count,
            "fan_in": in_count,
            "fan_out": out_count,
            "reasons": reasons,
            "risk_level": risk_label,
            "risk_score": risk_score,
        })

    results.sort(key=lambda r: r["risk_score"], reverse=True)
    return results


# ---------------------------------------------------------------------------
# 6. Case Summary
# ---------------------------------------------------------------------------

def generate_case_summary(
    transactions: list[dict],
    graph: dict,
    round_trips: list[dict],
    suspicious_accounts: list[dict],
    fund_flows: list[dict],
) -> dict:
    """Produce a high-level summary of the entire case analysis."""
    owner_map = graph.get("owner_map", {})
    unique_owners = set(owner_map.values())
    all_accounts = set(graph.get("nodes", {}).keys())

    dates = sorted(t.get("date") or "" for t in transactions if t.get("date"))
    total_debit = sum(_money(t.get("debit")) for t in transactions)
    total_credit = sum(_money(t.get("credit")) for t in transactions)

    return {
        "total_transactions": len(transactions),
        "total_source_files": len(set(t.get("source_file") for t in transactions if t.get("source_file"))),
        "total_primary_accounts": len(unique_owners),
        "total_unique_accounts": len(all_accounts),
        "date_range": f"{dates[0]} to {dates[-1]}" if len(dates) >= 2 else "",
        "total_debit": round(total_debit, 2),
        "total_credit": round(total_credit, 2),
        "round_trips_detected": len(round_trips),
        "suspicious_accounts_count": len(suspicious_accounts),
        "critical_accounts": len([a for a in suspicious_accounts if a["risk_level"] == "CRITICAL"]),
        "high_risk_accounts": len([a for a in suspicious_accounts if a["risk_level"] == "HIGH"]),
        "top_flows": fund_flows[:5],
    }


# ---------------------------------------------------------------------------
# 7. Full Analysis Pipeline
# ---------------------------------------------------------------------------

def run_full_analysis(transactions: list[dict]) -> dict:
    """Run the complete analysis pipeline and return all results."""
    graph = build_account_graph(transactions)
    round_trips = detect_round_trips(graph)
    money_trail = compute_money_trail(transactions)
    fund_flows = compute_fund_flow_summary(graph)
    suspicious = detect_suspicious_accounts(graph, round_trips)
    summary = generate_case_summary(
        transactions, graph, round_trips, suspicious, fund_flows
    )

    return {
        "summary": summary,
        "round_trips": round_trips,
        "money_trail": money_trail,
        "fund_flow_summary": fund_flows,
        "suspicious_accounts": suspicious,
    }
