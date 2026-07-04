import os
import sys
import parser.extractor

# Disable pdfium to see if it's causing the crash
parser.extractor.pdfium = None

from parser.extractor import extract_file
from concurrent.futures import ThreadPoolExecutor, as_completed

DATASET_ROOT = os.path.abspath(os.path.join("..", "Bank-statements-dataset", "Bank-statements-dataset"))

files = []
for folder in ("primary", "Secondary"):
    folder_path = os.path.join(DATASET_ROOT, folder)
    if os.path.exists(folder_path):
        for f in os.listdir(folder_path):
            files.append(os.path.join(folder_path, f))

print(f"Total files: {len(files)}")
print("Parsing concurrently without pdfium...")
try:
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(extract_file, f): f for f in files}
        for future in as_completed(futures):
            f = futures[future]
            try:
                future.result()
                print(f"Done: {os.path.basename(f)}")
            except Exception as e:
                print(f"Error {os.path.basename(f)}: {e}")
    print("Done all!")
except Exception as e:
    print(f"Concurrent error: {e}")
