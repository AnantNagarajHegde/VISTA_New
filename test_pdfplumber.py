import pdfplumber
import sys

def test_pdf(filepath):
    print(f"Testing {filepath}")
    with pdfplumber.open(filepath) as pdf:
        for i, page in enumerate(pdf.pages):
            print(f"--- Page {i} ---")
            table = page.extract_table(table_settings={
                "vertical_strategy": "text", 
                "horizontal_strategy": "text"
            })
            if table:
                for row in table[:5]:
                    print(row)
            else:
                print("No table found")
            break

if __name__ == "__main__":
    test_pdf(sys.argv[1])
