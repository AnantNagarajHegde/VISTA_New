import os
import pandas as pd
import pdfplumber
import traceback

DATA = r'd:\Hackathons\CIDECode_2026\VISTA_New\Bank-statements-dataset\Bank-statements-dataset'
files = [
    os.path.join(DATA, 'primary', '8642666611469255.pdf'),
    os.path.join(DATA, 'Secondary', '138488664629235-23-11-2024to11-12-2025.csv'),
    os.path.join(DATA, 'Secondary', '21558442690581muhammedGHOSHstatement.pdf'),
    os.path.join(DATA, 'Secondary', '250269305544183-23-11-2024to26-11-2025.csv'),
    os.path.join(DATA, 'Secondary', '269415176159622-18-03-2025to26-11-2025.csv'),
    os.path.join(DATA, 'Secondary', '3277373660.xlsx')
]

for f in files:
    print(f"\n{'='*50}\nFILE: {os.path.basename(f)}\n{'='*50}")
    ext = os.path.splitext(f)[1].lower()
    try:
        if ext == '.csv':
            for sep in [",", "\t", "|"]:
                try:
                    df = pd.read_csv(f, header=None, sep=sep, encoding="utf-8", on_bad_lines="skip")
                    if df.shape[1] >= 2:
                        print(f"--- CSV parsed with sep '{sep}' (utf-8) ---")
                        print(df.head(20))
                        break
                except Exception:
                    pass
        elif ext == '.xlsx':
            df = pd.read_excel(f, header=None, engine="openpyxl")
            print(df.head(20))
        elif ext == '.pdf':
            with pdfplumber.open(f) as pdf:
                page = pdf.pages[0]
                tables = page.extract_tables()
                if tables:
                    for i, row in enumerate(tables[0][:15]):
                        print(f"Row {i}: {row}")
                else:
                    print("No tables extracted by pdfplumber. Fallback text:")
                    print("\n".join(page.extract_text().split("\n")[:15]))
    except Exception as e:
        print(f"Error reading {os.path.basename(f)}: {e}")
