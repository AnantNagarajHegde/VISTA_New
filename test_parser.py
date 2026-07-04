import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))
from parser.extractor import extract_file

DATA = os.path.join(os.path.dirname(__file__), 'Bank-statements-dataset', 'Bank-statements-dataset')

print("FAILED FILES:")
for folder in ['primary', 'Secondary']:
    for f in sorted(os.listdir(os.path.join(DATA, folder))):
        fp = os.path.join(DATA, folder, f)
        if not os.path.isfile(fp): continue
        r = extract_file(fp)
        if not r['success']:
            print(f"  {folder}/{f}: {r['error']}")
