import { useState } from 'react';
import type { AnalysisData } from '../api';

interface ExportPanelProps {
  analysisData: AnalysisData | null;
  caseId: string | null;
  onDownloadExcel: () => void;
  onDownloadPdf: () => void;
  isLoading: boolean;
}

function formatAmount(val: number): string {
  if (val >= 10_000_000) return `₹${(val / 10_000_000).toFixed(2)} Cr`;
  if (val >= 100_000) return `₹${(val / 100_000).toFixed(2)} L`;
  return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ExportPanel({
  analysisData,
  caseId,
  onDownloadExcel,
  onDownloadPdf,
  isLoading,
}: ExportPanelProps) {
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);

  const handleExcel = async () => {
    setExporting('excel');
    try {
      await onDownloadExcel();
    } finally {
      setExporting(null);
    }
  };

  const handlePdf = async () => {
    setExporting('pdf');
    try {
      await onDownloadPdf();
    } finally {
      setExporting(null);
    }
  };

  const summary = analysisData?.summary;

  return (
    <div className="analysis-section">
      <div className="analysis-header">
        <div>
          <span className="analysis-title">Export Reports</span>
          <span className="analysis-count">Download investigation data</span>
        </div>
      </div>

      <div className="export-grid">
        {/* Excel Export Card */}
        <div className="export-card">
          <div className="export-card-icon export-excel-icon">
            <span>XLSX</span>
          </div>
          <div className="export-card-content">
            <h3 className="export-card-title">Excel Workbook</h3>
            <p className="export-card-desc">
              Multi-sheet workbook with all transactions, fund flows, round trips,
              money trail, and suspicious accounts.
            </p>
            <div className="export-sheets">
              <span className="export-sheet-tag">All Transactions</span>
              <span className="export-sheet-tag">Fund Flow Summary</span>
              <span className="export-sheet-tag">Round Trip Cycles</span>
              <span className="export-sheet-tag">Money Trail</span>
              <span className="export-sheet-tag">Suspicious Accounts</span>
              <span className="export-sheet-tag">Case Summary</span>
            </div>
            <button
              className="btn btn-accent export-btn"
              onClick={handleExcel}
              disabled={!caseId || isLoading || exporting !== null}
            >
              {exporting === 'excel' ? (
                <>
                  <span className="btn-spinner" />
                  Generating…
                </>
              ) : (
                '📥 Download Excel Report'
              )}
            </button>
          </div>
        </div>

        {/* PDF Export Card */}
        <div className="export-card">
          <div className="export-card-icon export-pdf-icon">
            <span>PDF</span>
          </div>
          <div className="export-card-content">
            <h3 className="export-card-title">PDF Report</h3>
            <p className="export-card-desc">
              Formatted investigation report with executive summary, key findings,
              and evidence tables. Ready for printing and sharing.
            </p>
            <div className="export-sheets">
              <span className="export-sheet-tag">Executive Summary</span>
              <span className="export-sheet-tag">Round Trips</span>
              <span className="export-sheet-tag">Suspicious Accounts</span>
              <span className="export-sheet-tag">Top Fund Flows</span>
            </div>
            <button
              className="btn btn-accent export-btn"
              onClick={handlePdf}
              disabled={!caseId || isLoading || exporting !== null}
            >
              {exporting === 'pdf' ? (
                <>
                  <span className="btn-spinner" />
                  Generating…
                </>
              ) : (
                '📄 Download PDF Report'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Summary Preview */}
      {summary && (
        <div className="export-summary">
          <h4 className="export-summary-title">Report Contents Preview</h4>
          <div className="export-summary-grid">
            <div className="export-summary-item">
              <span className="export-summary-value">{summary.total_transactions?.toLocaleString()}</span>
              <span className="export-summary-label">Transactions</span>
            </div>
            <div className="export-summary-item">
              <span className="export-summary-value">{summary.total_source_files}</span>
              <span className="export-summary-label">Source Files</span>
            </div>
            <div className="export-summary-item">
              <span className="export-summary-value">{summary.total_unique_accounts}</span>
              <span className="export-summary-label">Accounts</span>
            </div>
            <div className="export-summary-item">
              <span className="export-summary-value">{summary.round_trips_detected}</span>
              <span className="export-summary-label">Round Trips</span>
            </div>
            <div className="export-summary-item">
              <span className="export-summary-value">{summary.suspicious_accounts_count}</span>
              <span className="export-summary-label">Suspicious</span>
            </div>
            <div className="export-summary-item">
              <span className="export-summary-value">{formatAmount(summary.total_debit)}</span>
              <span className="export-summary-label">Total Debit</span>
            </div>
            <div className="export-summary-item">
              <span className="export-summary-value">{formatAmount(summary.total_credit)}</span>
              <span className="export-summary-label">Total Credit</span>
            </div>
            <div className="export-summary-item">
              <span className="export-summary-value">{summary.date_range || 'N/A'}</span>
              <span className="export-summary-label">Date Range</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
