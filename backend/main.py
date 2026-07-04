"""
VISTA Backend - FastAPI Application
Handles file upload, parsing, and case management for the hackathon MVP.
"""

from __future__ import annotations

import math
import os
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from parser.extractor import extract_file


app = FastAPI(
    title="VISTA API",
    description="Automated Bank Statement Analysis System",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5174", "http://127.0.0.1:5174",
        "http://localhost:5175", "http://127.0.0.1:5175"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

DATASET_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "Bank-statements-dataset", "Bank-statements-dataset")
)
MAX_PARSE_WORKERS = min(4, max(1, os.cpu_count() or 1))

cases: dict = {}
all_transactions: dict = {}
file_results: dict = {}


class CaseCreate(BaseModel):
    name: str = "VISTA Case"
    investigator: str = "Analyst"


def _new_case(case_id: Optional[str] = None, name: str = "VISTA Case", investigator: str = "Analyst") -> dict:
    case_id = case_id or str(uuid.uuid4())[:8]
    case = {
        "id": case_id,
        "name": name,
        "investigator": investigator,
        "status": "created",
        "created_at": datetime.now().isoformat(),
        "documents": 0,
        "transactions": 0,
        "alerts": 0,
        "needs_review": 0,
        "duplicates": 0,
    }
    cases[case_id] = case
    all_transactions[case_id] = []
    file_results[case_id] = []
    return case


def _money(value) -> float:
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    if math.isnan(amount) or math.isinf(amount):
        return 0.0
    return round(amount, 2)


def _dedupe_key(txn: dict) -> tuple:
    return (
        txn.get("date") or "",
        " ".join(str(txn.get("narration") or "").lower().split()),
        _money(txn.get("debit")),
        _money(txn.get("credit")),
        _money(txn.get("balance")),
    )


def _append_reason(txn: dict, reason: str) -> None:
    existing = [part.strip() for part in str(txn.get("review_reasons") or "").split(",") if part.strip()]
    if reason not in existing:
        existing.append(reason)
    txn["review_reasons"] = ", ".join(existing) if existing else None


def clean_case_transactions(transactions: list[dict]) -> tuple[list[dict], dict]:
    seen = set()
    cleaned: list[dict] = []
    duplicates = 0

    for txn in transactions:
        key = _dedupe_key(txn)
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        cleaned.append(dict(txn))

    previous_balance_by_statement: dict[tuple, float] = {}
    for txn in cleaned:
        statement_key = (txn.get("source_file"), txn.get("account_no") or "")
        balance = txn.get("balance")
        if balance is not None:
            prev_balance = previous_balance_by_statement.get(statement_key)
            if prev_balance is not None:
                expected = round(prev_balance - _money(txn.get("debit")) + _money(txn.get("credit")), 2)
                if abs(expected - _money(balance)) > 1.0:
                    _append_reason(txn, "balance_mismatch")
            previous_balance_by_statement[statement_key] = _money(balance)

    needs_review = sum(1 for txn in cleaned if txn.get("review_reasons"))
    reversals = sum(1 for txn in cleaned if txn.get("is_reversed"))
    balance_alerts = sum(1 for txn in cleaned if "balance_mismatch" in str(txn.get("review_reasons") or ""))

    return cleaned, {
        "duplicates": duplicates,
        "needs_review": needs_review,
        "alerts": reversals + balance_alerts,
    }


def _update_case_stats(case_id: str) -> None:
    cleaned, stats = clean_case_transactions(all_transactions[case_id])
    all_transactions[case_id] = cleaned
    cases[case_id]["documents"] = len(file_results[case_id])
    cases[case_id]["transactions"] = len(cleaned)
    cases[case_id]["duplicates"] = stats["duplicates"]
    cases[case_id]["needs_review"] = stats["needs_review"]
    cases[case_id]["alerts"] = stats["alerts"]
    cases[case_id]["status"] = "analyzed"


def _tag_source(result: dict, prefix: str) -> dict:
    if not prefix:
        return result
    for txn in result.get("transactions", []):
        txn["source_file"] = f"{prefix}/{txn.get('source_file') or result['filename']}"
    result["filename"] = f"{prefix}/{result['filename']}"
    return result


def _parse_paths(paths: list[tuple[str, str]]) -> list[dict]:
    indexed_results: list[tuple[int, dict]] = []
    with ThreadPoolExecutor(max_workers=MAX_PARSE_WORKERS) as executor:
        future_map = {
            executor.submit(extract_file, path): (index, prefix)
            for index, (path, prefix) in enumerate(paths)
        }
        for future in as_completed(future_map):
            index, prefix = future_map[future]
            try:
                result = _tag_source(future.result(), prefix)
            except Exception as exc:
                result = {
                    "success": False,
                    "filename": os.path.basename(paths[index][0]),
                    "transactions": [],
                    "transaction_count": 0,
                    "error": str(exc),
                }
            indexed_results.append((index, result))
    return [result for _, result in sorted(indexed_results, key=lambda item: item[0])]


def _record_results(case_id: str, results: list[dict]) -> dict:
    failed = 0
    new_transactions = 0

    for result in results:
        if result["success"]:
            all_transactions[case_id].extend(result["transactions"])
            new_transactions += result["transaction_count"]
        else:
            failed += 1

        file_results[case_id].append({
            "filename": result["filename"],
            "success": result["success"],
            "transaction_count": result["transaction_count"],
            "error": result["error"],
        })

    _update_case_stats(case_id)
    return {
        "files_processed": len(results),
        "files_succeeded": len(results) - failed,
        "files_failed": failed,
        "new_transactions": new_transactions,
        "total_transactions": len(all_transactions[case_id]),
        "results": [
            {
                "filename": result["filename"],
                "success": result["success"],
                "transaction_count": result["transaction_count"],
                "error": result["error"],
            }
            for result in results
        ],
    }


@app.get("/api/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


@app.post("/api/case/create")
async def create_case(data: CaseCreate):
    return _new_case(name=data.name, investigator=data.investigator)


@app.get("/api/case/{case_id}")
async def get_case(case_id: str):
    if case_id not in cases:
        raise HTTPException(status_code=404, detail="Case not found")
    return cases[case_id]


@app.get("/api/case/{case_id}/transactions")
async def get_transactions(case_id: str, page: int = 1, page_size: int = 100):
    if case_id not in all_transactions:
        raise HTTPException(status_code=404, detail="Case not found")

    page = max(1, page)
    page_size = min(max(25, page_size), 500)
    txns = all_transactions[case_id]
    total = len(txns)
    start = (page - 1) * page_size
    end = start + page_size

    return {
        "transactions": txns[start:end],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total > 0 else 0,
    }


@app.get("/api/case/{case_id}/files")
async def get_file_results(case_id: str):
    if case_id not in file_results:
        raise HTTPException(status_code=404, detail="Case not found")
    return {"files": file_results[case_id]}


@app.post("/api/case/{case_id}/upload")
async def upload_files(case_id: str, files: list[UploadFile] = File(...)):
    if case_id not in cases:
        raise HTTPException(status_code=404, detail="Case not found")

    case_dir = os.path.join(UPLOAD_DIR, case_id)
    os.makedirs(case_dir, exist_ok=True)

    parse_targets: list[tuple[str, str]] = []
    for uploaded_file in files:
        safe_name = os.path.basename(uploaded_file.filename or f"upload-{uuid.uuid4().hex}")
        file_path = os.path.join(case_dir, safe_name)
        with open(file_path, "wb") as handle:
            handle.write(await uploaded_file.read())
        parse_targets.append((file_path, ""))

    return _record_results(case_id, _parse_paths(parse_targets))


@app.post("/api/case/demo")
async def load_demo_case():
    case_id = "demo"
    _new_case(case_id=case_id, name="VISTA Demo Case", investigator="Analyst")
    cases[case_id]["status"] = "processing"

    parse_targets: list[tuple[str, str]] = []
    for folder in ("primary", "Secondary"):
        folder_path = os.path.join(DATASET_ROOT, folder)
        if not os.path.exists(folder_path):
            continue
        for filename in sorted(os.listdir(folder_path)):
            file_path = os.path.join(folder_path, filename)
            if os.path.isfile(file_path):
                parse_targets.append((file_path, folder))

    summary = _record_results(case_id, _parse_paths(parse_targets))
    return {
        "case_id": case_id,
        "files_processed": summary["files_processed"],
        "files_succeeded": summary["files_succeeded"],
        "files_failed": summary["files_failed"],
        "total_transactions": summary["total_transactions"],
    }


@app.get("/api/case/{case_id}/flow")
async def get_flow_data(case_id: str, top_n: int = 50):
    """Extract unique accounts and build directed money-flow edges.

    Returns at most *top_n* accounts (by total volume) and the edges
    between them so the frontend graph stays readable and performant.
    """
    if case_id not in all_transactions:
        raise HTTPException(status_code=404, detail="Case not found")

    top_n = max(10, min(top_n, 200))
    txns = all_transactions[case_id]

    # --- Collect accounts and edges ---
    account_info: dict[str, dict] = {}
    edge_agg: dict[tuple, dict] = {}

    def _ensure_account(acc_id: str, acc_type: str = "counterparty", label: str | None = None):
        if not acc_id:
            return
        if acc_id not in account_info:
            account_info[acc_id] = {
                "id": acc_id,
                "label": label or acc_id,
                "type": acc_type,
                "transaction_count": 0,
                "total_debit": 0.0,
                "total_credit": 0.0,
            }
        if acc_type == "primary":
            account_info[acc_id]["type"] = "primary"

    def _add_edge(src: str, tgt: str, amount: float):
        if not src or not tgt or src == tgt:
            return
        key = (src, tgt)
        if key not in edge_agg:
            edge_agg[key] = {"source": src, "target": tgt, "amount": 0.0, "count": 0}
        edge_agg[key]["amount"] = round(edge_agg[key]["amount"] + amount, 2)
        edge_agg[key]["count"] += 1

    # Build source_file -> owner account mapping
    file_to_account: dict[str, str] = {}
    for txn in txns:
        sf = txn.get("source_file") or ""
        acc = (txn.get("account_no") or "").strip()
        if sf and acc and sf not in file_to_account:
            file_to_account[sf] = acc
    for txn in txns:
        sf = txn.get("source_file") or ""
        if sf and sf not in file_to_account:
            base = os.path.splitext(os.path.basename(sf))[0]
            file_to_account[sf] = base

    # Register primary accounts
    for _sf, acc_id in file_to_account.items():
        _ensure_account(acc_id, "primary", acc_id)

    # Build edges and track stats for BOTH owner and counterparty
    for txn in txns:
        sf = txn.get("source_file") or ""
        owner_id = file_to_account.get(sf, "")
        if not owner_id:
            continue

        debit = _money(txn.get("debit"))
        credit = _money(txn.get("credit"))

        # Update owner stats
        if owner_id in account_info:
            account_info[owner_id]["transaction_count"] += 1
            account_info[owner_id]["total_debit"] = round(
                account_info[owner_id]["total_debit"] + debit, 2
            )
            account_info[owner_id]["total_credit"] = round(
                account_info[owner_id]["total_credit"] + credit, 2
            )

        # Determine counterparty
        cp = (txn.get("counterparty_account") or "").strip()
        if not cp:
            cp = (txn.get("upi_id") or "").strip()
        if not cp:
            continue

        _ensure_account(cp, "counterparty", cp)

        # Update counterparty stats (mirror of owner)
        account_info[cp]["transaction_count"] += 1
        if debit > 0:
            # Owner debits = counterparty receives (credit)
            account_info[cp]["total_credit"] = round(
                account_info[cp]["total_credit"] + debit, 2
            )
            _add_edge(owner_id, cp, debit)
        if credit > 0:
            # Owner credits = counterparty sent (debit)
            account_info[cp]["total_debit"] = round(
                account_info[cp]["total_debit"] + credit, 2
            )
            _add_edge(cp, owner_id, credit)

    # --- Filter to top N accounts by total volume ---
    all_accounts = list(account_info.values())
    all_accounts.sort(
        key=lambda a: a["total_debit"] + a["total_credit"],
        reverse=True,
    )
    # Always keep primary accounts, fill remaining slots with top counterparties
    primary = [a for a in all_accounts if a["type"] == "primary"]
    others = [a for a in all_accounts if a["type"] != "primary"]
    remaining_slots = max(0, top_n - len(primary))
    kept = primary + others[:remaining_slots]
    kept_ids = {a["id"] for a in kept}

    # Only return edges between kept accounts
    filtered_edges = [
        e for e in edge_agg.values()
        if e["source"] in kept_ids and e["target"] in kept_ids
    ]

    return {
        "accounts": kept,
        "edges": filtered_edges,
        "total_accounts": len(all_accounts),
        "total_edges": len(edge_agg),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

