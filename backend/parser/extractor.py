"""
VISTA generic bank statement extractor.

The MVP intentionally uses one deterministic ingestion path for PDF, Excel,
CSV, and TXT files. It detects likely header rows, maps columns into the
canonical transaction schema, and keeps low-confidence fields visible instead
of silently dropping them.
"""

from __future__ import annotations

import csv
import os
import re
import traceback
from datetime import datetime, timedelta
from typing import Optional

import pandas as pd
import pdfplumber

try:
    import pypdfium2 as pdfium
except Exception:
    pdfium = None
import threading
_pdfium_lock = threading.Lock()


FIELD_KEYWORDS = {
    "date": [
        "date", "tran date", "transaction date", "txn dt", "txn date",
        "value date", "value dt", "posting date", "post date", "pstd dt",
        "transaction posted date",
    ],
    "narration": [
        "narration", "particulars", "particular", "tran particular",
        "transaction particulars", "description", "remarks", "rmks",
        "details", "transaction details",
    ],
    "debit": [
        "debit", "withdrawal", "withdrawals", "debit amount", "debit amt",
        "withdrawal amt", "withdrawal amount", "dr", "dr amt", "dr amount",
    ],
    "credit": [
        "credit", "deposit", "deposits", "credit amount", "credit amt",
        "deposit amt", "deposit amount", "cr", "cr amt", "cr amount",
    ],
    "amount": [
        "amount", "amt", "transaction amount", "txn amount", "amount inr",
        "amount(inr)", "amount (inr)",
    ],
    "balance": [
        "balance", "bal", "balance amount", "closing balance",
        "running balance", "closing bal", "available balance",
    ],
}

EXTRA_FIELD_KEYWORDS = {
    "account_no": [
        "ac no", "a/c no", "account no", "account number", "acct no",
        "benef/remit acct no", "benef remit acct no", "remit acct no",
    ],
    "account_name": [
        "account name", "ac name", "benef/remit name", "benef remit name",
        "name",
    ],
    "tran_id": [
        "tran id", "transaction id", "txn id", "ref no", "reference",
        "ref chq no", "chq no", "instrument no", "utr", "rrn",
        "ref txn no", "ctr batch no",
    ],
    "tran_type": ["tran type", "transaction type", "txn type", "type", "dr/cr"],
    "ifsc": ["ifsc", "benef/remit ifsc code", "benef remit ifsc code"],
}

CANONICAL_COLUMNS = [
    "date", "narration", "debit", "credit", "balance", "source_file",
    "row_number", "account_no", "account_name", "tran_id", "tran_type",
    "counterparty_account", "ifsc", "upi_id", "is_reversed", "review_reasons",
]


def _normalize_text(value) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).replace("\xa0", " ")).strip()


def _normalize_header(value) -> str:
    text = _normalize_text(value).lower()
    text = text.replace("/", " ").replace("_", " ").replace("-", " ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _keyword_matches(header: str, keyword: str) -> bool:
    normalized_keyword = _normalize_header(keyword)
    if not normalized_keyword:
        return False
    if len(normalized_keyword) <= 3:
        return re.search(rf"\b{re.escape(normalized_keyword)}\b", header) is not None
    return normalized_keyword in header


def find_header_row(rows: list, max_scan: int = 35) -> Optional[int]:
    best_idx = None
    best_score = 0

    for idx, row in enumerate(rows[:max_scan]):
        if row is None:
            continue
        row_text = " ".join(_normalize_header(cell) for cell in row)
        if not row_text:
            continue

        hits = {
            field
            for field, keywords in FIELD_KEYWORDS.items()
            if any(_keyword_matches(row_text, keyword) for keyword in keywords)
        }
        score = len(hits)
        if "date" in hits:
            score += 1
        if {"debit", "credit"} & hits or "amount" in hits:
            score += 1

        if score > best_score:
            best_score = score
            best_idx = idx

    return best_idx if best_score >= 4 else None


def map_columns(header_row: list) -> dict:
    mapping: dict[str, int] = {}

    for idx, column in enumerate(header_row):
        header = _normalize_header(column)
        if not header:
            continue

        for field, keywords in FIELD_KEYWORDS.items():
            if field not in mapping and any(_keyword_matches(header, kw) for kw in keywords):
                mapping[field] = idx
                break

        for field, keywords in EXTRA_FIELD_KEYWORDS.items():
            if field not in mapping and any(_keyword_matches(header, kw) for kw in keywords):
                mapping[field] = idx
                break

    return mapping


def clean_amount(value, *, signed: bool = False) -> Optional[float]:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and not pd.isna(value):
        return float(value)

    raw = _normalize_text(value)
    if not raw or raw in {"-", "--"} or raw.lower() in {"nan", "none", "null"}:
        return None

    lower = raw.lower()
    is_negative = False
    if signed and (" dr" in f" {lower}" or lower.endswith("dr")):
        is_negative = True
    if raw.startswith("(") and raw.endswith(")"):
        is_negative = True

    raw = re.sub(r"\b(cr|dr)\b\.?$", "", raw, flags=re.IGNORECASE).strip()
    raw = raw.replace(",", "").replace("Rs.", "").replace("INR", "")
    raw = raw.replace("(", "-").replace(")", "")
    match = re.search(r"-?\d+(?:\.\d+)?", raw)
    if not match:
        return None

    try:
        amount = float(match.group(0))
    except ValueError:
        return None

    if signed and is_negative and amount > 0:
        amount *= -1
    return amount


def clean_date(value) -> Optional[str]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, (int, float)) and not pd.isna(value):
        try:
            return (datetime(1899, 12, 30) + timedelta(days=int(value))).strftime("%Y-%m-%d")
        except Exception:
            return None

    raw = _normalize_text(value)
    if not raw or raw.lower() in {"nan", "none", "date", "tran date", "txn date"}:
        return None

    date_token = raw.split()[0]
    compact = re.match(r"^(\d{2})([A-Za-z]{3})(\d{4})", raw)
    if compact:
        date_token = f"{compact.group(1)}-{compact.group(2)}-{compact.group(3)}"

    for fmt in (
        "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y",
        "%d-%m-%y", "%d/%m/%y", "%d.%m.%y",
        "%d-%b-%Y", "%d/%b/%Y", "%d-%b-%y", "%d/%b/%y",
        "%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y",
    ):
        try:
            return datetime.strptime(date_token, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue

    return raw if re.search(r"\d", raw) else None


def extract_entities(narration: str | None, account_no: str | None = None, ifsc: str | None = None) -> dict:
    text = _normalize_text(narration)
    result = {
        "counterparty_account": _normalize_text(account_no) or None,
        "ifsc": _normalize_text(ifsc).upper() or None,
        "upi_id": None,
    }

    if text:
        upi_match = re.search(r"\b[a-zA-Z0-9._-]{2,}@[a-zA-Z][a-zA-Z0-9._-]{2,}\b", text)
        if upi_match:
            result["upi_id"] = upi_match.group(0)

        ifsc_match = re.search(r"\b[A-Z]{4}0[A-Z0-9]{6}\b", text.upper())
        if ifsc_match and not result["ifsc"]:
            result["ifsc"] = ifsc_match.group(0)

        account_match = re.search(r"(?<!\d)(\d{9,18})(?!\d)", text)
        if account_match and not result["counterparty_account"]:
            result["counterparty_account"] = account_match.group(1)

    return result


def _is_repeated_header(row: list) -> bool:
    return find_header_row([row], max_scan=1) == 0


def rows_to_dataframe(rows: list, source_file: str) -> Optional[pd.DataFrame]:
    if not rows or len(rows) < 2:
        return None

    header_idx = find_header_row(rows)
    if header_idx is None:
        return None

    mapping = map_columns(rows[header_idx])
    has_amount = "amount" in mapping or "debit" in mapping or "credit" in mapping
    if "date" not in mapping or not has_amount:
        return None

    records: list[dict] = []
    for offset, row in enumerate(rows[header_idx + 1:]):
        if row is None:
            continue
        row = list(row)
        if not any(_normalize_text(cell) for cell in row):
            continue
        if _is_repeated_header(row):
            continue

        record = {
            "source_file": source_file,
            "row_number": header_idx + 2 + offset,
            "date": None,
            "narration": None,
            "debit": None,
            "credit": None,
            "balance": None,
            "account_no": None,
            "account_name": None,
            "tran_id": None,
            "tran_type": None,
            "ifsc": None,
        }

        for field in ["date", "narration", "debit", "credit", "balance", "amount"]:
            if field not in mapping:
                continue
            col_idx = mapping[field]
            value = row[col_idx] if col_idx < len(row) else None
            if field == "date":
                record["date"] = clean_date(value)
            elif field == "balance":
                record["balance"] = clean_amount(value, signed=True)
            elif field in {"debit", "credit", "amount"}:
                record[field] = clean_amount(value)
            else:
                record[field] = _normalize_text(value) or None

        for field in ["account_no", "account_name", "tran_id", "tran_type", "ifsc"]:
            if field in mapping:
                col_idx = mapping[field]
                value = row[col_idx] if col_idx < len(row) else None
                record[field] = _normalize_text(value) or None

        if record.get("amount") is not None:
            amount = record.pop("amount")
            direction = _normalize_text(record.get("tran_type")).lower()
            if record["debit"] is None and record["credit"] is None:
                if amount < 0 or re.search(r"\bdr\b|debit|withdraw", direction):
                    record["debit"] = abs(amount)
                else:
                    record["credit"] = abs(amount)

        if not record["date"] and not record["debit"] and not record["credit"] and record["narration"] and records:
            records[-1]["narration"] = f"{records[-1].get('narration') or ''} {record['narration']}".strip()
            continue

        if not record["date"] and not record["debit"] and not record["credit"]:
            continue

        entity_fields = extract_entities(record.get("narration"), record.get("account_no"), record.get("ifsc"))
        record.update(entity_fields)

        reasons: list[str] = []
        if not record["date"]:
            reasons.append("missing_date")
        if not record["narration"]:
            reasons.append("missing_narration")
        if record["debit"] is None and record["credit"] is None:
            reasons.append("missing_amount")

        narration = (record.get("narration") or "").upper()
        record["is_reversed"] = "REVERSED" in narration or "REVERSAL" in narration
        record["review_reasons"] = ", ".join(reasons) if reasons else None

        records.append(record)

    if not records:
        return None

    df = pd.DataFrame(records)
    for column in CANONICAL_COLUMNS:
        if column not in df.columns:
            df[column] = None
    for column in ["debit", "credit", "balance"]:
        df[column] = pd.to_numeric(df[column], errors="coerce")
    return df[CANONICAL_COLUMNS]


def detect_file_type(filepath: str) -> str:
    ext = os.path.splitext(filepath)[1].lower()
    try:
        with open(filepath, "rb") as handle:
            header = handle.read(8)
    except OSError:
        return ext.lstrip(".")

    if header.startswith(b"%PDF"):
        return "pdf"
    if header.startswith(b"PK\x03\x04"):
        return "xlsx"
    if header.startswith(b"\xd0\xcf\x11\xe0"):
        return "xls"
    if ext == ".txt":
        return "txt"
    return "csv" if ext == ".csv" else ext.lstrip(".")



DATE_TOKEN_RE = r"\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}"
AMOUNT_TOKEN_RE = r"-?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|-?\d+(?:\.\d+)?"


def _rows_from_pdf_text(text: str) -> list[list]:
    rows = [["date", "narration", "debit", "credit", "balance"]]
    current_row = None

    line_re = re.compile(rf"^({DATE_TOKEN_RE})\s+(?:(?:{DATE_TOKEN_RE})\s+)?(.+)$", re.IGNORECASE)
    amount_re = re.compile(AMOUNT_TOKEN_RE)

    for raw_line in text.splitlines():
        line = _normalize_text(raw_line)
        if not line:
            continue

        match = line_re.match(line)
        if not match:
            if current_row is not None:
                current_row[1] = f"{current_row[1]} {line}".strip()
            continue

        date_value = match.group(1)
        rest = match.group(2)
        amount_matches = list(amount_re.finditer(rest))
        if len(amount_matches) < 3:
            if current_row is not None:
                current_row[1] = f"{current_row[1]} {line}".strip()
            continue

        last_three = amount_matches[-3:]
        narration = rest[:last_three[0].start()].strip(" -|:")
        debit = last_three[0].group(0)
        credit = last_three[1].group(0)
        balance = last_three[2].group(0)
        current_row = [date_value, narration, debit, credit, balance]
        rows.append(current_row)

    return rows if len(rows) > 1 else []


def _extract_pdf_text_fast(filepath: str) -> str:
    if pdfium is None:
        return ""

    with _pdfium_lock:
        parts = []
        document = pdfium.PdfDocument(filepath)
        try:
            for page_index in range(len(document)):
                page = document[page_index]
                text_page = page.get_textpage()
                try:
                    parts.append(text_page.get_text_range())
                finally:
                    text_page.close()
                    page.close()
        finally:
            document.close()
        return "\n".join(parts)


def extract_pdf(filepath: str) -> Optional[pd.DataFrame]:
    source_file = os.path.basename(filepath)

    try:
        fast_text = _extract_pdf_text_fast(filepath)
        if fast_text:
            text_rows = _rows_from_pdf_text(fast_text)
            df = rows_to_dataframe(text_rows, source_file) if text_rows else None
            if df is not None and len(df) > 0:
                return df
    except Exception:
        pass

    text_rows: list[list] = []
    table_rows: list[list] = []
    try:
        with pdfplumber.open(filepath) as pdf:
            text_parts = []
            for page in pdf.pages:
                page_text = page.extract_text() or ""
                if page_text:
                    text_parts.append(page_text)

            if text_parts:
                text_rows = _rows_from_pdf_text("\n".join(text_parts))
                df = rows_to_dataframe(text_rows, source_file) if text_rows else None
                if df is not None and len(df) > 0:
                    return df

            for page in pdf.pages:
                table = page.extract_table()
                if table:
                    table_rows.extend(table)
    except Exception:
        return None

    return rows_to_dataframe(table_rows, source_file) if table_rows else None


def _read_excel_rows(filepath: str, engine: str) -> list:
    raw = pd.read_excel(filepath, header=None, engine=engine)
    return raw.where(pd.notnull(raw), None).values.tolist()


def extract_excel(filepath: str) -> Optional[pd.DataFrame]:
    source_file = os.path.basename(filepath)
    try:
        return rows_to_dataframe(_read_excel_rows(filepath, "openpyxl"), source_file)
    except Exception:
        return None


def extract_xls(filepath: str) -> Optional[pd.DataFrame]:
    source_file = os.path.basename(filepath)
    for engine in ("xlrd", "openpyxl"):
        try:
            df = rows_to_dataframe(_read_excel_rows(filepath, engine), source_file)
            if df is not None and len(df) > 0:
                return df
        except Exception:
            continue
    return None


def extract_csv(filepath: str) -> Optional[pd.DataFrame]:
    source_file = os.path.basename(filepath)
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            with open(filepath, "r", encoding=encoding, errors="replace", newline="") as handle:
                content = handle.read()
        except Exception:
            continue
        if not content.strip():
            continue

        for delimiter in (",", "\t", "|", ";"):
            try:
                rows = list(csv.reader(content.splitlines(), delimiter=delimiter))
                df = rows_to_dataframe(rows, source_file)
                if df is not None and len(df) > 0:
                    return df
            except Exception:
                continue
    return None


def extract_txt(filepath: str) -> Optional[pd.DataFrame]:
    source_file = os.path.basename(filepath)
    for encoding in ("utf-8", "latin-1"):
        try:
            with open(filepath, "r", encoding=encoding, errors="replace") as handle:
                lines = handle.read().splitlines()
            rows = []
            for line in lines:
                line = line.strip()
                if not line or set(line) <= {"-"}:
                    continue
                parts = line.split("\t") if "\t" in line else re.split(r"\s{2,}", line)
                if len(parts) >= 3:
                    rows.append(parts)
            df = rows_to_dataframe(rows, source_file)
            if df is not None and len(df) > 0:
                return df
        except Exception:
            continue
    return None


EXTRACTORS = {
    "pdf": extract_pdf,
    "xlsx": extract_excel,
    "xls": extract_xls,
    "csv": extract_csv,
    "txt": extract_txt,
}



def _json_safe(value):
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value

def extract_file(filepath: str) -> dict:
    filename = os.path.basename(filepath)
    file_type = detect_file_type(filepath)

    extractor = EXTRACTORS.get(file_type)
    if extractor is None:
        return {
            "success": False,
            "filename": filename,
            "transactions": [],
            "transaction_count": 0,
            "error": f"Unsupported file format: {file_type or 'unknown'}",
        }

    try:
        df = extractor(filepath)
        if df is None or len(df) == 0:
            return {
                "success": False,
                "filename": filename,
                "transactions": [],
                "transaction_count": 0,
                "error": "Could not extract transactions (no header detected or empty table)",
            }

        df = df.astype(object).where(pd.notnull(df), None)
        transactions = [_json_safe(row) for row in df.to_dict(orient="records")]
        return {
            "success": True,
            "filename": filename,
            "transactions": transactions,
            "transaction_count": len(transactions),
            "error": None,
        }
    except Exception as exc:
        traceback.print_exc()
        return {
            "success": False,
            "filename": filename,
            "transactions": [],
            "transaction_count": 0,
            "error": str(exc),
        }







