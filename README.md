
# VISTA (Visual Investigative Suite for Transaction Analysis)

<p align="center">
  <img src="Implementation_plan/Vista_logo.png" alt="VISTA Logo">
</p>

VISTA is an automated financial intelligence platform built for law enforcement, auditors, and financial investigators. It drastically reduces the time required to analyze chaotic bank statements by automating data extraction, deduplication, money trailing, and anomaly detection. What used to take forensic teams weeks of manual effort can now be achieved in seconds.

## 🚀 Key Features

*   **Automated Data Parsing & Cleaning:** Ingests raw PDFs and Excel bank statements, automatically extracting transaction data and beneficiaries using intelligent regex heuristics and `pdfplumber`.
*   **Deduplication Engine:** Automatically cleans and normalizes duplicate transactions when users upload multiple overlapping exports from the same bank account.
*   **The Money Trail (FIFO Analysis):** Automatically tracks large deposits to see exactly where the funds were transferred next, providing a clear map of money movement.
*   **Round-Trip Detection:** Detects circular money movement (A → B → C → A) to expose classic money laundering techniques and fake revenue generation.
*   **Suspicious Account Profiling:** Analyzes the "Money Graph" to flag accounts acting as pass-throughs, money mules (high fan-in/fan-out), or operating with unusually high volume.
*   **Court-Ready Automated Reporting:** Generates comprehensive, multi-sheet Excel workbooks and PDF investigation reports summarizing the entire case, including verified fund flows and prioritized suspect lists.

## 🛠️ Technology Stack

**Frontend:**
*   **React 19** + **TypeScript**
*   **Vite** for lightning-fast bundling

**Backend:**
*   **FastAPI** (Python 3) for high-performance API endpoints
*   **Pandas** & **OpenPyXL** for heavy data manipulation and Excel export generation
*   **pdfplumber** & **pypdfium2** for precise text extraction from bank PDFs
*   **ReportLab** for dynamic PDF report generation

## ⚙️ Local Setup & Installation

Follow these steps to get VISTA running locally on your machine.

### Prerequisites
*   Node.js (v18+)
*   Python (3.10+)

### 1. Clone the repository
```bash
git clone https://github.com/your-org/VISTA.git
cd VISTA
```

### 2. Backend Setup
Navigate to the `backend` directory, create a virtual environment, and install dependencies.
```bash
cd backend
python -m venv venv

# On Windows:
.\venv\Scripts\activate
# On Mac/Linux:
source venv/bin/activate

pip install -r requirements.txt
```

### 3. Frontend Setup
Navigate to the `frontend` directory and install dependencies.
```bash
cd ../frontend
npm install
```

## ▶️ Running the Application

You will need to run the frontend and backend simultaneously in separate terminal windows.

**Start the Backend Server (Terminal 1):**
```bash
cd backend
# Make sure your venv is activated
python main.py
# The server will start on http://localhost:8000
```

**Start the Frontend Development Server (Terminal 2):**
```bash
cd frontend
npm run dev
# The frontend will start on http://localhost:5173 (or similar)
```

## 📁 Project Structure

```text
VISTA/
├── backend/
│   ├── main.py              # FastAPI application & endpoints
│   ├── analyzer.py          # Core logic (Graph building, Cycle detection, FIFO)
│   ├── exporter.py          # Excel (openpyxl) and PDF (reportlab) generation
│   ├── parser/              # Modules for parsing different bank statement formats
│   └── requirements.txt     # Python dependencies
├── frontend/
│   ├── src/                 # React components and views
│   ├── package.json         # Node.js dependencies
│   └── vite.config.ts       # Vite bundler configuration
└── README.md
```

