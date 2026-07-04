import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

import parser.extractor
_orig_fast = parser.extractor._extract_pdf_text_fast
_pdfium_lock = threading.Lock()

def _safe_extract(*args, **kwargs):
    with _pdfium_lock:
        return _orig_fast(*args, **kwargs)

parser.extractor._extract_pdf_text_fast = _safe_extract

from parser.extractor import extract_file

DATASET_ROOT = os.path.abspath(os.path.join("..", "Bank-statements-dataset", "Bank-statements-dataset"))
files = []
for folder in ("primary", "Secondary"):
    folder_path = os.path.join(DATASET_ROOT, folder)
    if os.path.exists(folder_path):
        for f in os.listdir(folder_path):
            files.append(os.path.join(folder_path, f))

print("Parsing concurrently with lock...")
try:
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(extract_file, f): f for f in files}
        for future in as_completed(futures):
            f = futures[future]
            try:
                future.result()
            except Exception as e:
                pass
    print("Done all!")
except Exception as e:
    print(f"Concurrent error: {e}")
