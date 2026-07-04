# VISTA — 12-Hour Hackathon MVP Plan
### Ruthlessly Scoped for a 3-Person Student Team, Limited Hardware, Zero Budget

**Reality check on the previous plan:** That was a 28–39 hour production-shaped build. This one is scoped to **12 hours, done**. Everything not essential to a working demo has been cut, not deferred with a fancy name — cut.

---

## 0. What's IN and what's OUT (read this before writing any code)

### IN — build these, nothing else
1. Upload PDF + Excel/CSV (drag-and-drop is a stretch; a plain file input is fine)
2. One generic extraction path that works across most bank formats (not four family-specific parsers)
3. Basic cleaning: duplicate removal, reversal detection, balance validation
4. Rule-based round-trip detection, capped at a small hop depth
5. Simple money trail (FIFO) for at least one account
6. A graph view (even a static-feeling one is fine)
7. PDF + Excel report download

### OUT — do not touch these in 12 hours
- Multi-parser "Bank Format Registry" with 4+ dedicated per-bank parsers — **use ONE generic parser instead**
- OCR pipeline — your dataset has **zero scanned PDFs** (confirmed by direct inspection), so this buys you nothing for the demo. If you have spare time at the very end, add a token Tesseract call; otherwise skip entirely.
- Fuzzy entity resolution (`rapidfuzz` name matching) — use exact string/account-number matching only
- FastAPI + React split — **use Streamlit** unless someone on the team already has a React app half-built
- Docker, SQLite schema migrations, async task queues — use in-memory pandas DataFrames + one SQLite file if you need persistence at all
- Isolation Forest / any ML model — pure rule-based detection is enough for MVP and is easier to explain to judges anyway
- Multi-hop generalized cycle detection with amount-decay tolerance — hard-code a 2–4 hop cycle check instead

**If you remember one sentence from this whole document: build one ugly working pipeline end-to-end before making anything pretty.**

---

## 1. The Stack (Final — Do Not Debate This on the Day)

| Need | Tool | Why this and not the "proper" option |
|---|---|---|
| Web app (upload + display + everything) | **Streamlit** | One Python file gets you upload, tables, charts, and download buttons with zero separate frontend build. This is the single biggest time-saver available to you. |
| PDF text extraction | **pdfplumber** | Also gives `.extract_tables()` for free — handles both text and table-shaped PDFs in one call |
| Excel/CSV | **pandas** (`read_excel`, `read_csv`) | Already free, already know it |
| Data cleaning | **pandas** | No new library |
| Graph + round-trip detection | **NetworkX** | `simple_cycles()` does round-trip detection in ~5 lines |
| Graph visualization | **Pyvis** | Generates an interactive HTML graph you can embed directly in Streamlit with `components.html()` |
| PDF report | **fpdf2** (not WeasyPrint) | Zero system dependencies (WeasyPrint needs Pango/Cairo installed, which is a real risk on a laptop with "limited hardware resources" — fpdf2 is pure Python, pip install and go) |
| Excel report | **openpyxl** (via `pandas.to_excel`) | Already free |
| OCR (only if time remains) | **pytesseract** | Not needed for your actual dataset — deprioritize completely |

**No Docker. No React. No FastAPI. No SQLite unless someone finishes early.** Run everything as `streamlit run app.py`.

---

## 2. Simplified Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Streamlit App (single process, single file to start)     │
│                                                            │
│  [Upload Widget] → pandas DataFrame per file               │
│         │                                                  │
│         ▼                                                  │
│  [Generic Extractor]                                       │
│    - PDF: pdfplumber table extraction, fallback to         │
│      line-by-line regex if no table detected                │
│    - Excel/CSV: pandas + fuzzy header row detection          │
│      (scan first 20 rows for a row containing              │
│      "date"/"debit"/"credit"/"balance" keywords)            │
│         │                                                  │
│         ▼                                                  │
│  [Canonical DataFrame]: Date | Narration | Debit | Credit  │
│                          | Balance | Source_File            │
│         │                                                  │
│         ▼                                                  │
│  [Cleaning]                                                 │
│    - drop_duplicates() on (Date, Narration, Debit, Credit)  │
│    - regex match "REVERSED" or exact debit==credit reversal │
│      pair within 24h → flag                                 │
│    - recompute running balance, flag mismatches             │
│         │                                                  │
│         ▼                                                  │
│  [Entity Extraction — regex only]                           │
│    - pull account no / IFSC / UPI handle from narration     │
│      with 3–4 regex patterns                                │
│    - group by extracted identifier → build account list     │
│         │                                                  │
│         ▼                                                  │
│  [Round-Trip Detection]                                     │
│    - Build directed graph: node=account, edge=transaction   │
│    - networkx.simple_cycles(graph, length_bound=4)          │
│    - flag any cycle found                                   │
│         │                                                  │
│         ▼                                                  │
│  [Money Trail — FIFO, one account at a time]                 │
│    - pick largest credit → walk debit queue chronologically │
│         │                                                  │
│         ▼                                                  │
│  [Display in Streamlit]                                     │
│    - st.dataframe() for tables                              │
│    - Pyvis HTML embed for graph                             │
│    - st.download_button() for PDF (fpdf2) and Excel          │
│      (openpyxl)                                              │
└──────────────────────────────────────────────────────────┘
```

That's the entire system. One file can hold all of this if you want (`app.py`), or split into 4–5 small modules if the team is working in parallel (see §4).

---

## 3. The Generic Extractor — the only ingestion logic you need

Do not build per-bank parsers. Build **one** function that tries table extraction first, falls back to line-based regex if that fails:

```python
import pdfplumber, pandas as pd, re

FIELD_KEYWORDS = {
    "date": ["date", "tran date", "txn dt", "value date"],
    "narration": ["narration", "particulars", "description", "remarks"],
    "debit": ["debit", "withdrawal", "dr"],
    "credit": ["credit", "deposit", "cr"],
    "balance": ["balance", "bal"],
}

def find_header_row(rows):
    """Scan first ~20 rows for the one that looks like a header."""
    for i, row in enumerate(rows[:20]):
        row_text = " ".join(str(c).lower() for c in row if c)
        hits = sum(1 for kws in FIELD_KEYWORDS.values()
                   if any(k in row_text for k in kws))
        if hits >= 3:          # at least 3 of 5 fields recognizable
            return i
    return None

def map_columns(header_row):
    mapping = {}
    for idx, col in enumerate(header_row):
        col_l = str(col).lower()
        for field, kws in FIELD_KEYWORDS.items():
            if any(k in col_l for k in kws):
                mapping[field] = idx
    return mapping

def extract_pdf(path):
    with pdfplumber.open(path) as pdf:
        all_rows = []
        for page in pdf.pages:
            table = page.extract_table()
            if table:
                all_rows.extend(table)
    header_idx = find_header_row(all_rows)
    if header_idx is None:
        return None   # falls back to OCR or manual review — deprioritized for MVP
    mapping = map_columns(all_rows[header_idx])
    data_rows = all_rows[header_idx + 1:]
    return pd.DataFrame([
        {field: row[idx] if idx < len(row) else None
         for field, idx in mapping.items()}
        for row in data_rows
    ])

def extract_excel_csv(path):
    raw = pd.read_excel(path, header=None) if path.endswith(("xlsx", "xls")) \
          else pd.read_csv(path, header=None)
    rows = raw.values.tolist()
    header_idx = find_header_row(rows)
    if header_idx is None:
        return None
    mapping = map_columns(rows[header_idx])
    df = raw.iloc[header_idx + 1:].reset_index(drop=True)
    return df.rename(columns={v: k for k, v in mapping.items()})[list(mapping.keys())]
```

This ~50-line function is the entire ingestion layer. It won't get every file perfectly, and that's fine — for a 12-hour MVP, **partial coverage across many files beats perfect coverage of one file.** Any row it can't map, just skip and count it in a "files not fully parsed" counter you can mention honestly in the demo.

---

## 4. Hour-by-Hour Plan (3-Person Team, Parallel Tracks)

Assumes a 12-hour window with no big breaks. Adjust start time to your actual hackathon clock.

| Hour | Person A (Ingestion + Cleaning) | Person B (Detection + Graph) | Person C (Streamlit UI + Reports) |
|---|---|---|---|
| 0–1 | Env setup, install all libraries, confirm pdfplumber/pandas work on 2–3 real sample files | Env setup, install networkx/pyvis, sketch graph data structure on paper | Env setup, install streamlit/fpdf2, scaffold empty `app.py` with upload widget |
| 1–3 | Build the generic extractor (§3), test against 5 files from `primary/` | Write round-trip detection function against **mock data** (don't wait for A) | Build upload → "raw preview table" flow so something is visibly working early |
| 3–4 | Build cleaning functions: dedup, reversal detection, balance check | Continue testing round-trip logic against mock data; write FIFO money-trail function | Wire up display of cleaned DataFrame in Streamlit |
| 4–5 | **Integration checkpoint:** hand off clean DataFrame format to Person B | Switch to real DataFrame from Person A; debug graph construction | Build the alerts table display |
| 5–6 | Help debug extractor edge cases found by B/C; start on entity regex extraction | Finish round-trip + money trail against real data, produce at least one flagged cycle | Build Pyvis graph embed in Streamlit |
| 6–7 | Finish entity regex extraction (account no / UPI / IFSC patterns) | Polish detection output format (what fields alerts need for reporting) | Continue graph embed; start report layout planning |
| 7–8 | **Full pipeline test:** run all 18 primary files through Extract → Clean → Entity, fix breakages | Feed entity-resolved data into round-trip + money trail, re-test | Build PDF report generator (fpdf2) — static layout first, wire data in after |
| 8–9 | Support integration debugging | Support integration debugging | Build Excel export (openpyxl), wire download buttons |
| 9–10 | **Full end-to-end run:** upload → clean → detect → visualize → report, whole team debugging together | (same) | (same) |
| 10–11 | Buffer for whatever broke in hour 9 | Buffer | Polish UI text/labels, make sure numbers shown match reality |
| 11–12 | Demo rehearsal (run it live twice, on two different sample cases if time allows) | Demo rehearsal | Demo rehearsal |

**Critical rule:** by **Hour 5**, all three tracks must be working against the *same real DataFrame shape*, even if the content is wrong. Integration failures discovered at Hour 10 are fatal in a 12-hour window; integration failures discovered at Hour 5 are fixable.

---

## 5. What to Actually Demo

You already have real fraud-case data with a genuine primary → secondary layering structure. Use it:

1. Upload 3–4 files from `primary/` live, on stage.
2. Show the cleaned transaction table — point out one real duplicate or reversal it caught.
3. Show the graph view — even if small, point to one real multi-hop chain in your actual data.
4. If a round-trip cycle is found in the real data, lead with that as your "aha" moment. If none is found in the time you have, **say so honestly** and show the algorithm working on a small synthetic example instead — judges respect "here's what it found in real data, and here's it working correctly on a constructed case" far more than a fudged result.
5. Click download → show the PDF and Excel report actually opening.

That's a complete, honest, working demo.

---

## 6. Stretch Goals — Only If Hour 9 Arrives Early

The hackathon brief explicitly says you *may* use AI/ML/LLM to go beyond the basics — but only reach for these if the core pipeline (§0 "IN" list) is already fully working and demoed successfully in a dry run:

- **Fuzzy name matching** (`rapidfuzz`) to merge obvious name variants across 2 files — 30-minute add-on, easy to demo
- **A single scikit-learn Isolation Forest** on transaction amounts as a "statistical anomaly" tab — cheap to add, sounds impressive, doesn't risk the core demo
- **One small local LLM call is still off the table** given your hardware constraint — don't attempt this even as a stretch goal unless you have a genuinely fast internet connection and are willing to risk a live API dependency during the demo
- **OCR fallback** — only add this if someone has completely finished their track and is bored; it will not be exercised by your real dataset

Do not attempt more than one stretch goal. Pick the one most likely to survive a live demo without crashing.

---

## 7. If Something Is Behind Schedule at Hour 6

Cut in this order, cheapest-to-cut first:
1. Drop entity regex extraction — group accounts by raw account number string only, no cleverness
2. Drop money trail FIFO — round-trip detection alone is still a strong demo
3. Drop Pyvis graph — show the round-trip cycle as a printed list of accounts instead (`A → B → C → A`)
4. Never drop: upload, basic cleaning, and the report download — these three are the minimum bar for "a working web app," which is the one non-negotiable requirement in the brief.
