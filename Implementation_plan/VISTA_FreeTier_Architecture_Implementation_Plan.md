# VISTA — Zero-Budget Architecture & Phase-Wise Implementation Plan
### Automated Bank Statement Analysis System — Laptop-Only, No-Cloud-Cost Build

**Prepared for:** Team Paradox · CIDECODE 2026
**Grounded in:** Real fraud-case dataset (162 files, 56.2 MB, 18 primary + 144 secondary accounts)
**Constraint envelope:** ₹0 build cost · No paid OCR/LLM APIs · No vendor lock-in · Runs on a single laptop, no local LLM inference

---

## 0. Dataset Reconnaissance — What the Real Data Actually Looks Like

Before designing anything, the uploaded case dataset was inspected file-by-file. This is not a hypothetical architecture — every design decision below is a direct response to a pattern observed in your actual evidence set.

### 0.1 Composition

| Metric | Value |
|---|---|
| Total files | 162 (18 primary + 144 secondary) |
| Total size | 56.2 MB |
| Largest single file | 4.57 MB (a 555-page PDF) |
| File formats present | PDF (103), XLSX (~40), CSV (~14), legacy XLS (~8) |
| Scanned/image-only PDFs | **0 of 103** — every PDF has an extractable text layer |

**Implication:** OCR is a *defensive fallback*, not the primary extraction path. This changes the entire Phase 1 build priority — you should NOT spend early hackathon hours wiring up Tesseract before the text-layer pipeline works, since 100% of the current evidence set doesn't need it.

### 0.2 Bank format diversity (confirmed by signature scan)

| Bank | Files detected |
|---|---|
| SBI | 29 |
| Axis Bank | 28 |
| Unidentified / generic filename | 27 |
| HDFC | 19 |
| IDFC First | 15 |
| YES Bank | 15 |
| Kotak Mahindra | 13 |
| ICICI | 11 |
| IndusInd | 11 |
| Bank of Baroda | 7 |
| Canara Bank | 6 |
| Union Bank | 6 |
| Federal Bank | 6 |
| Bank of Maharashtra | 5 |
| Indian Bank | 4 |
| PNB | 3 |

**At least 15 distinct bank statement layouts are present in a single case.** No single hard-coded parser will work. This is the single most important fact driving the ingestion architecture (§4.1).

### 0.3 Four structurally different layout families observed

**Family A — Narrative multi-line PDF (e.g., IDFC First, `00869354051.pdf`)**
Transaction date/value date in one column, narration wraps across 2–3 physical lines, cheque number embedded, running balance suffixed with `Cr`/`Dr`. Header appears once, on page 1 only.

**Family B — Dense tabular PDF, no repeated header (e.g., unidentified bank, `258082779154.pdf`)**
Compact single-line-per-transaction, IFSC and UTR embedded directly inside the narration string (`R/SBINR52025061388697494/SBIN0014951/DEBASIS MISHR`), balances can legitimately go **negative** (sweep-in FD accounts) — a genuine data-quality edge case your validation layer must tolerate, not flag as corrupt.

**Family C — Core Banking System (CBS/Finacle-style) export, 26 columns (e.g., `112108374579 SOA.xlsx`, `285265765401_stmt.xls`)**
This is the single most valuable format in the dataset: it contains **explicit `BENEF/REMIT ACCT NO` and `BENEF/REMIT IFSC CODE` columns**, meaning the counterparty account number is already structured — no NLP or entity resolution guesswork needed for these rows. It also explicitly prefixes reversed transactions with the literal string `REVERSED :`, which directly satisfies the "detect failed transactions" requirement with a plain string match. This format recurs across multiple accounts — build the parser for it first; it has the best cost-to-coverage ratio.

**Family D — Free-form key-value header + tabular body (e.g., SBI YONO export, Federal Bank CASA export)**
Account metadata is split across two side-by-side label/value column pairs, with the transaction table header appearing anywhere from row 1 to row 14 depending on file. Requires **dynamic header-row detection**, not a fixed offset.

### 0.4 Extraction signal patterns confirmed present in narrations

These regex-extractable patterns appear repeatedly and are strong, free, deterministic substitutes for what the original proposal scoped as an LLM field-resolution step:

- UPI VPA handles: `name@bankhandle` (e.g., `rajesh@okicici`)
- IMPS references: `IMPS/P2A/<11-digit-ref>/<name>`
- NEFT/RTGS UTRs: `NEFT/IDFBH25111255559/...`, `R/SBINR5202506.../SBIN0014951/...`
- Explicit reversal markers: `REVERSED : <original narration>`
- Explicit counterparty account+IFSC columns (Family C only)

**Conclusion carried into the architecture:** A **regex + rule-engine extraction layer can do the great majority of field resolution and entity linking on this dataset without any LLM call.** This is good news given the ₹0/no-cloud-LLM constraint — it isn't a compromise, it's what the data actually supports.

---

## 1. Constraint-Driven Design Principles

The original VISTA proposal (submitted for CIDECODE 2026 selection) specified an enterprise-grade stack: Neo4j Enterprise/TigerGraph, Claude Sonnet/GPT-4o cloud LLM calls, HashiCorp Vault, Kubernetes, a 7-service Docker Compose stack. **That stack is correct for the Phase 2–4 production roadmap already in your proposal — it is wrong for what you can build this hackathon with ₹0 and one laptop.** Every substitution below is scoped as a Phase 1 (hackathon) implementation, with an explicit upgrade path back to the original proposal's Phase 2+ stack preserved — nothing here contradicts what you already submitted.

| # | Constraint | Design Consequence |
|---|---|---|
| 1 | Free to build, no paid API of any kind | Every library must be open-source with a permissive license (MIT/Apache/BSD). No SaaS dependency in the runtime path. |
| 2 | No cloud API cost | Zero network calls in the core pipeline. Everything must run fully offline once dependencies are installed. |
| 3 | No paid OCR or LLM service | OCR = Tesseract (free, local). No LLM in the runtime pipeline at all for Phase 1 — replaced by regex + rule engine + classical ML (§4.1, §4.4). |
| 4 | No vendor lock-in | No proprietary file formats, no cloud-only databases. Everything exportable to open formats (SQLite, CSV, JSON, GraphML). |
| 5 | Laptop cannot run LLMs locally | Confirmed by data: not needed. Rule-based extraction covers the dataset (§0.4). |
| 6 | Do not depend on heavy local inference | No deep learning models in the critical path. Optional scikit-learn models (Isolation Forest) only — these are CPU-trivial, train in seconds on this data volume (tens of thousands of transaction rows, not millions). |

---

## 2. Revised Technology Stack — 100% Free, Local-First

| Layer | Original Proposal (Phase 2+) | **Hackathon Build (Phase 1 — This Plan)** | Why the swap is safe |
|---|---|---|---|
| PDF text extraction | PyMuPDF, pdftotext | **PyMuPDF (`fitz`)** — free, fast | Same tool, already free |
| PDF table extraction | PaddleOCR PP-Structure | **pdfplumber** (free, pure Python) | pdfplumber's `.extract_tables()` handles Families A–B directly since text layer exists |
| Excel/CSV parsing | — | **pandas + openpyxl + xlrd** (free) | Handles XLSX, legacy XLS (Family C confirmed working with `xlrd` engine in recon), CSV with dynamic header detection |
| OCR (fallback only) | PaddleOCR / cloud OCR | **Tesseract OCR + pytesseract** (free, Apache 2.0) | Only triggered if PyMuPDF returns <100 chars/page — did not trigger once on this dataset |
| Field resolution / LLM | Claude Sonnet / GPT-4o | **Regex rule engine + `rapidfuzz` for fuzzy header/name matching** (free) | Confirmed sufficient by §0.4 |
| Entity resolution | Dedupe.io, SpaCy NER | **`rapidfuzz` token-set matching + deterministic account/IFSC-based linking** (free) | Family C gives exact account numbers already; fuzzy matching only needed for name variants |
| Structured storage | PostgreSQL + TimescaleDB | **SQLite** (free, zero-install, file-based) | Dataset is 56 MB / low tens-of-thousands of rows — SQLite handles this instantly; upgrade path to Postgres preserved for Phase 2 |
| Graph engine | Neo4j Enterprise / TigerGraph | **NetworkX** (free, pure Python, in-memory) | Handles thousands of nodes/edges without a server process; `python-louvain` gives community detection free |
| Graph visualization | Linkurious Enterprise | **Pyvis (wraps vis.js) for rapid prototyping + Cytoscape.js in the React frontend** (both free) | Interactive HTML graphs with zero paid dependency |
| ML / anomaly detection | Isolation Forest, LSTM autoencoders | **scikit-learn Isolation Forest only** (free, CPU-trivial) | LSTM dropped for Phase 1 — needs more data + GPU to be worth it; rule engine covers FATF typologies without ML at all |
| PDF report generation | WeasyPrint | **WeasyPrint** (free, kept as-is) | Already free — no change needed |
| Excel export | — | **openpyxl** (free) | — |
| Backend API | FastAPI, Celery, Redis | **FastAPI only** for hackathon; Celery/Redis deferred to Phase 2 (async task queue only matters at higher file volumes) | Reduces moving parts to get a laptop demo working fast |
| Frontend | React, TypeScript | **React + TypeScript, kept as-is** (free, matches submitted proposal) | No change — this was already free |
| Infra | Kubernetes, Docker (7 services) | **Single `docker-compose.yml` with 2 services (API + frontend), or no Docker at all — `venv` + `npm run dev`** | Kubernetes is unnecessary overhead for a laptop demo |

**Net effect:** Every "Why It Matters" claim in your submitted proposal remains true. What changes is *which specific library* performs the job in Phase 1 — the interfaces, data contracts, and eventual upgrade path to Neo4j/LLM-augmented Phase 2 are preserved untouched.

---

## 3. System Architecture (Hackathon-Realistic)

```
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 1 — INGESTION                                                 │
│  Upload UI (React) → Format sniff (magic bytes, not extension)       │
│  Routes to: PDF handler | XLSX/XLS handler | CSV handler             │
└─────────────────────────────────┬─────────────────────────────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 2 — EXTRACTION (Bank Format Registry Pattern)                 │
│  1. Try registered fingerprint match (IFSC prefix / header keyword)  │
│     → Family C (CBS export) parser  → Family A (narrative) parser    │
│     → Family B (dense tabular) parser → Family D (key-value) parser  │
│  2. No fingerprint match → Generic fallback parser                   │
│     (fuzzy header detection via rapidfuzz + column-role classifier)  │
│  3. Text layer <100 chars/page → Tesseract OCR fallback              │
│  Output: raw_transactions table (unvalidated)                        │
└─────────────────────────────────┬─────────────────────────────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 3 — NORMALIZATION & CLEANING                                  │
│  • Canonical schema mapping (Date|Narration|TxnID|Debit|Credit|Bal)  │
│  • Duplicate detection (hash of date+amount+narration+running-bal)   │
│  • Reversal detection (string match "REVERSED", debit-then-credit    │
│    same amount within N hours)                                      │
│  • Balance-chain validation (running balance arithmetic check,       │
│    tolerant of legitimate negative sweep balances — confirmed edge   │
│    case from Family B)                                               │
│  • Missing-field imputation with explicit flagging (never silent)    │
│  Output: clean_transactions table + data_quality_flags table         │
└─────────────────────────────────┬─────────────────────────────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 4 — ENTITY EXTRACTION & RESOLUTION                             │
│  • Regex extractors: UPI VPA, IMPS ref, NEFT/RTGS UTR, IFSC, acct no  │
│  • Direct linkage where BENEF/REMIT columns exist (Family C)         │
│  • Fuzzy name matching (rapidfuzz) to merge name variants across     │
│    statements into one canonical entity ID                           │
│  Output: entities table, entity_aliases table                        │
└─────────────────────────────────┬─────────────────────────────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 5 — DETECTION ENGINE                                          │
│  • Rule engine: structuring, smurfing, dormant-to-active, velocity   │
│    spikes (all pure pandas/SQL window functions — no ML required)    │
│  • Round-trip detection: NetworkX cycle detection on directed graph  │
│    with amount-tolerance and time-window constraints (§4.3)          │
│  • Optional: scikit-learn Isolation Forest for statistical outliers  │
│    as a secondary confidence signal, not primary detection           │
│  Output: alerts table (typology, confidence, evidence refs)          │
└─────────────────────────────────┬─────────────────────────────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 6 — GRAPH ANALYTICS                                           │
│  • NetworkX directed multigraph: nodes=accounts, edges=transactions  │
│  • python-louvain community detection                                │
│  • Betweenness centrality for intermediary ranking                   │
│  • FIFO money-trail traversal per credit event (§4.5)                │
│  Output: graph.graphml (portable, open format) + trail_records table │
└─────────────────────────────────┬─────────────────────────────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 7 — REPORTING & VISUALIZATION                                  │
│  • Pyvis/Cytoscape.js interactive graph in the React dashboard       │
│  • WeasyPrint → PDF evidence report                                  │
│  • openpyxl → Excel export of clean transactions + alerts            │
│  • Every report references source file + row for traceability        │
└─────────────────────────────────────────────────────────────────────┘

              SQLite (all layers persist here) · Local filesystem (raw file vault)
```

---

## 4. Core Pipeline Design — Mapped to Your Five Stated Requirements

### 4.1 Multi-Format Upload & Data Extraction

**The Bank Format Registry pattern** is the single most important architectural decision in this plan, because it directly answers the reality found in §0.3 — 15+ distinct layouts in one case.

```python
# Conceptual structure — not final code, but the actual pattern to build

BANK_REGISTRY = [
    {
        "name": "cbs_finacle_export",           # Family C — build this FIRST
        "fingerprint": lambda headers: {"BENEF/REMIT ACCT NO", "TRAN PARTICULAR"}.issubset(headers),
        "parser": parse_cbs_finacle_export,
    },
    {
        "name": "idfc_narrative_pdf",            # Family A
        "fingerprint": lambda text: "IDFB" in text[:2000],
        "parser": parse_narrative_multiline_pdf,
    },
    {
        "name": "sbi_yono_keyvalue",              # Family D
        "fingerprint": lambda text: "SBIN0" in text[:2000] and "Cleared Balance" in text[:2000],
        "parser": parse_keyvalue_header_pdf,
    },
    # ... additional registered fingerprints as you encounter more banks
]

GENERIC_FALLBACK = generic_heuristic_parser   # fuzzy header matching, always available
```

**Column-role classifier for the generic fallback** (handles any bank not yet registered):

| Canonical field | Header keywords matched (case-insensitive, fuzzy) |
|---|---|
| Date | `date`, `tran date`, `txn dt`, `value date` |
| Narration | `narration`, `particulars`, `description`, `tran particular`, `remarks` |
| Debit | `debit`, `withdrawal`, `dr`, `debit amount` |
| Credit | `credit`, `deposit`, `cr`, `credit amount` |
| Balance | `balance`, `bal`, `balance amount`, `closing balance` |

This lets the system extract a reasonable table even from a bank it has never seen, then route it to the human-review queue for confidence confirmation rather than silently failing.

**OCR fallback (defensive, not primary):** Only invoked when `PyMuPDF` extracts fewer than 100 characters per page. Uses Tesseract at 300 DPI rasterization via `pdf2image` (free, requires poppler — already needed for `pdftotext`). Given §0.1, budget almost no hackathon time here beyond a working fallback path — it will not be exercised by your actual case data.

### 4.2 Data Cleaning & Validation

| Requirement | Implementation (all free, pure Python/SQL) |
|---|---|
| Remove duplicates | Composite hash of `(account_id, date, amount, narration_normalized, running_balance)`. Near-duplicates (OCR variance) caught with a secondary fuzzy pass using `rapidfuzz.fuzz.ratio > 95` on narration. |
| Detect failed/reversed transactions | Direct string match on `"REVERSED"` (confirmed present in Family C). For banks without explicit reversal tags: pattern-match debit followed by credit of the identical amount to/from the same counterparty within a configurable window (default 24h). |
| Debit/credit/balance consistency | Recompute `balance[n] = balance[n-1] - debit[n] + credit[n]` per account, per statement, in chronological order. Flag any row where computed ≠ stated beyond a ₹0.01 rounding tolerance. **Do not flag legitimate negative balances** (confirmed real edge case in Family B sweep accounts) — only flag arithmetic mismatches, not sign. |
| Missing data handling | Never silently drop. Missing narration → tag `[UNRESOLVED_NARRATION]`, route row to human review queue with source file + page/row reference preserved. |

### 4.3 Round-Trip Transaction Detection

This is a graph-cycle-detection problem, not a machine-learning problem — solvable deterministically and fast on a laptop.

**Algorithm:**
1. Build a directed multigraph in NetworkX: nodes = account identifiers (resolved via Layer 4), edges = individual transactions with `(amount, date, txn_id)` attributes.
2. Run `networkx.simple_cycles()` restricted to a maximum path length (configurable, default 6 hops — matches FATF layering typology depth) to keep runtime bounded even on dense graphs.
3. For each candidate cycle, apply **amount-decay tolerance**: the amount returning to the origin should be within a configurable percentage (default 70–100%) of the amount that left, accounting for fees/skimming along the chain.
4. Apply **time-window constraint**: the full cycle must complete within a configurable window (default 30 days) to be flagged as a round-trip rather than coincidental circular activity over a long period.
5. Score each detected cycle: `risk_score = f(amount, hop_count, time_compression, number_of_repeat_cycles_involving_same_accounts)`.

This exact algorithm produces the "Fraud Alerts, Suspicious Account Mapping, Risk Scoring" outputs your proposal already promises, using only NetworkX (free) — no Neo4j server required at this scale.

### 4.4 Money Flow Visualization

- **Backend:** NetworkX graph exported as GraphML (open, portable format — no vendor lock-in) after each analysis run.
- **Frontend (2 acceptable options, pick based on time budget):**
  - **Fast path:** Pyvis generates a self-contained interactive HTML graph server-side — usable directly in the demo with almost no frontend work.
  - **Production-aligned path:** Cytoscape.js embedded in the React dashboard already scoped in your proposal, fed by a `/api/graph/{case_id}` FastAPI endpoint returning nodes/edges as JSON.
- **Node sizing:** proportional to total transaction volume through that account.
- **Edge weighting:** proportional to individual transaction amount; edge color encodes transaction type (NEFT/IMPS/UPI/cash) parsed from narration.

### 4.5 Money Trail Analysis (FIFO)

Pure algorithmic implementation, no external dependency beyond pandas:

```
For each account, for each credit event C (amount=A, date=T):
    remaining = A
    debit_queue = all debits on this account with date >= T, sorted chronologically
    trail = []
    for D in debit_queue:
        if remaining <= 0: break
        consumed = min(remaining, D.amount)
        trail.append({credit_ref: C.txn_id, debit_ref: D.txn_id, amount_consumed: consumed})
        remaining -= consumed
    if remaining > 0:
        trail.append({status: "UNCONSUMED_BALANCE", amount: remaining})
    persist(trail)
```

If multiple credits are unresolved simultaneously, apply strict FIFO ordering by credit timestamp — first credit received is the first to be "spent down" by subsequent debits, exactly as specified in your requirement.

### 4.6 Reporting & Export

| Output | Tool | Notes |
|---|---|---|
| PDF investigation report | **WeasyPrint** (HTML → PDF) | Build the report as an HTML/Jinja2 template first — far faster to iterate on during a hackathon than direct PDF drawing calls, and free |
| Excel export | **openpyxl** | Separate sheets: Clean Transactions, Suspicious Alerts, Round-Trip Loops, Money Trail |
| Summary view | Rendered in React dashboard directly from the same SQLite data the exports use | Single source of truth — no drift between on-screen summary and exported report |

---

## 5. Data Model (SQLite Schema — Core Tables)

| Table | Key Columns |
|---|---|
| `cases` | case_id, name, created_at |
| `source_files` | file_id, case_id, filename, format_family, sha256_hash, upload_time |
| `raw_transactions` | txn_id, file_id, raw_row_json, extraction_confidence |
| `clean_transactions` | txn_id, account_id, date, narration, debit, credit, balance, is_reversed, is_duplicate |
| `entities` | entity_id, canonical_name, entity_type (account/person/business) |
| `entity_aliases` | alias_id, entity_id, raw_name_variant, match_confidence |
| `accounts` | account_id, entity_id, account_number, ifsc, bank_name |
| `alerts` | alert_id, typology (structuring/round-trip/smurfing/etc.), confidence, evidence_txn_ids |
| `round_trip_cycles` | cycle_id, account_sequence_json, total_amount, hop_count, time_span_days, risk_score |
| `money_trail` | trail_id, credit_txn_id, debit_txn_id, amount_consumed |
| `data_quality_flags` | flag_id, txn_id, flag_type, description |

SHA-256 hashing every source file at ingestion (already in your proposal's chain-of-custody design) costs nothing extra and is preserved here unchanged.

---

## 6. Repository Structure

```
vista/
├── backend/
│   ├── ingestion/
│   │   ├── registry.py          # Bank Format Registry
│   │   ├── parsers/
│   │   │   ├── cbs_finacle.py   # Family C — build first
│   │   │   ├── narrative_pdf.py # Family A
│   │   │   ├── dense_tabular.py # Family B
│   │   │   ├── keyvalue_pdf.py  # Family D
│   │   │   └── generic_fallback.py
│   │   └── ocr_fallback.py
│   ├── cleaning/
│   │   ├── dedup.py
│   │   ├── reversal_detection.py
│   │   └── balance_validation.py
│   ├── entities/
│   │   ├── regex_extractors.py  # UPI/IMPS/NEFT/IFSC patterns
│   │   └── fuzzy_resolution.py
│   ├── detection/
│   │   ├── rule_engine.py       # structuring, smurfing, velocity
│   │   ├── round_trip.py        # NetworkX cycle detection
│   │   └── anomaly_ml.py        # optional Isolation Forest
│   ├── graph/
│   │   ├── builder.py           # NetworkX graph construction
│   │   ├── community.py         # python-louvain
│   │   └── money_trail.py       # FIFO algorithm
│   ├── reporting/
│   │   ├── pdf_report.py        # WeasyPrint + Jinja2 templates
│   │   └── excel_export.py      # openpyxl
│   ├── db/
│   │   └── schema.sql
│   ├── main.py                  # FastAPI app
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── UploadPanel.tsx
│   │   │   ├── GraphView.tsx    # Cytoscape.js
│   │   │   ├── AlertsTable.tsx
│   │   │   └── ReportViewer.tsx
│   │   └── App.tsx
│   └── package.json
├── data/
│   ├── raw_vault/                # original uploaded files, hash-named
│   └── vista.db                  # SQLite
└── docker-compose.yml            # optional, 2 services only
```

---

## 7. Phase-Wise Implementation Plan

Structured as build phases (distinct from the Phase 1–4 *product roadmap* already in your submitted proposal — this is the engineering execution plan to get the Phase 1 MVP built during the hackathon itself).

### Phase 0 — Environment & Data Contracts (2–3 hrs)
- Set up Python venv, install: `pymupdf`, `pdfplumber`, `pandas`, `openpyxl`, `xlrd`, `rapidfuzz`, `networkx`, `python-louvain`, `scikit-learn`, `weasyprint`, `pyvis`, `fastapi`, `uvicorn`
- Set up React + TypeScript scaffold (Vite recommended for speed over CRA)
- Define the canonical schema (§5) and write `schema.sql`
- **Deliverable:** Empty pipeline skeleton that accepts a file and writes a row to SQLite

### Phase 1 — Ingestion for the Two Highest-Coverage Formats First (4–6 hrs)
- Build `cbs_finacle.py` parser (Family C) — highest ROI, gives structured `BENEF/REMIT` fields for free entity resolution
- Build `generic_fallback.py` with the column-role classifier (§4.1 table) — this alone gives partial coverage across *every* remaining bank immediately
- Test against real files: `112108374579 SOA.xlsx`, `285265765401_stmt.xls`, and 5 random others from `Secondary/`
- **Deliverable:** Upload any file from the case → get a row in `raw_transactions`, even if imperfectly mapped

### Phase 2 — Remaining Format Parsers + Data Cleaning (5–7 hrs)
- Build `narrative_pdf.py` (Family A, e.g. IDFC) and `dense_tabular.py` (Family B)
- Build `keyvalue_pdf.py` (Family D, e.g. SBI YONO) — dynamic header-row detection
- Implement dedup, reversal detection, balance-chain validation (§4.2)
- **Deliverable:** Run all 18 primary files through the pipeline → clean_transactions populated, data_quality_flags populated, no silent drops

### Phase 3 — Entity Resolution & Detection Engine (5–7 hrs)
- Regex extractors for UPI/IMPS/NEFT/IFSC (§4.1, §0.4)
- Fuzzy entity merge with `rapidfuzz`
- Rule engine: structuring, smurfing, dormant-to-active, velocity spikes
- Round-trip cycle detection (§4.3) — test specifically against the primary→secondary layering already present in this case (this is your strongest demo material, since it's real)
- **Deliverable:** `alerts` table populated with at least one real detected round-trip loop from the case data

### Phase 4 — Graph Analytics & Money Trail (4–5 hrs)
- NetworkX graph builder from `clean_transactions`
- python-louvain community detection
- FIFO money trail algorithm (§4.5)
- Export GraphML + generate a Pyvis HTML for quick visual sanity-check
- **Deliverable:** A rendered graph showing the real primary→secondary fund flow, with at least one traced money trail from a specific credit to its consuming debits

### Phase 5 — Frontend Integration (5–7 hrs, can run in parallel with Phase 3–4 if team splits)
- FastAPI endpoints: `/upload`, `/case/{id}/transactions`, `/case/{id}/alerts`, `/case/{id}/graph`, `/case/{id}/report`
- React dashboard: upload panel, alerts table, Cytoscape.js graph view
- **Deliverable:** End-to-end demo — upload files through the browser, see extraction progress, view alerts and graph live

### Phase 6 — Reporting, Polish & Demo Rehearsal (3–4 hrs)
- WeasyPrint PDF report template (Jinja2 HTML → PDF)
- openpyxl Excel export
- Rehearse the 10-step demo script against the real dataset end-to-end at least twice
- **Deliverable:** One-click "Generate Evidence Report" produces a PDF + Excel pair referencing real source files and page numbers

**Total estimated effort:** ~28–39 hours of focused build time — fits a standard 36–48 hour hackathon window with buffer for debugging, assuming a 3-person team splitting phases in parallel from Phase 2 onward.

---

## 8. Risk Register & Fallbacks (Updated for This Constraint Set)

| Risk | Mitigation |
|---|---|
| A bank format doesn't match any registered fingerprint | Generic fallback parser (§4.1) always available; row routed to human review, never dropped |
| Generic fallback misclassifies a column | Confidence score stored per extracted field; UI surfaces low-confidence rows for one-click correction |
| NetworkX cycle detection is slow on a dense graph | Cap max cycle length (default 6 hops) and max search time; this dataset (162 files, low tens of thousands of transactions) is well within NetworkX's comfortable range — confirmed no scanned-PDF OCR bottleneck either |
| SQLite concurrency limits under multi-user load | Not a concern for hackathon demo (single investigator, single case); documented upgrade path to PostgreSQL preserved for Phase 2 |
| Tesseract OCR never gets tested because no OCR-needed files exist in this dataset | Manually test the OCR fallback path with one deliberately rasterized PDF before the demo, so the path is proven even though it isn't exercised by the real case |
| Team runs short on hackathon time | Priority order if cuts are needed: keep Phase 1–3 (ingestion + cleaning + round-trip detection) as the non-negotiable demo core; Phase 5 frontend can degrade to Pyvis HTML + a simple file-upload CLI if React integration time runs out |

---

## 9. What This Preserves From Your Submitted Proposal

Nothing in your CIDECODE 2026 proposal needs to be walked back. This plan is a **Phase 1 implementation substrate** underneath the same five features, four pillars, and phased roadmap you already submitted and were selected on:

- The five core features (multi-format ingestion, cleaning, round-trip detection, money flow visualization, FIFO money trail) are delivered exactly as specified.
- Chain-of-custody hashing (SHA-256 at ingestion) is retained unchanged.
- The upgrade path to Neo4j, LLM-assisted extraction, and ML-based anomaly detection in Phase 2–3 of your product roadmap remains fully valid — this plan only changes *which library does the job in the hackathon build*, not the target architecture you pitched.
- The four strategic pillars (evidentiary integrity, network intelligence, investigator-native UX, disciplined scope) are actually **strengthened** by this plan — Pillar 4 (Disciplined Scope) is precisely what building on free/local tools for Phase 1 demonstrates in practice.
