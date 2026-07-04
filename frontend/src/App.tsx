import { useState, useCallback } from 'react';
import CaseControl from './components/CaseControl';
import CaseDetails from './components/CaseDetails';
import TransactionsTable from './components/TransactionsTable';
import FileResults from './components/FileResults';
import FundFlowTable from './components/FundFlowTable';
import RoundTripsTable from './components/RoundTripsTable';
import SuspiciousAccounts from './components/SuspiciousAccounts';
import ExportPanel from './components/ExportPanel';
import {
  createCase,
  getCase,
  getTransactions,
  getFileResults,
  uploadFiles,
  loadDemoCase,
  getAnalysis,
  downloadExcel,
  downloadPdf,
} from './api';
import type {
  CaseData,
  TransactionsResponse,
  FileResult,
  AnalysisData,
} from './api';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

type TabId = 'transactions' | 'files' | 'fundflow' | 'roundtrips' | 'suspicious' | 'export';

function App() {
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [transactions, setTransactions] = useState<TransactionsResponse | null>(null);
  const [fileResultsList, setFileResultsList] = useState<FileResult[]>([]);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [loadingSubMessage, setLoadingSubMessage] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('transactions');

  const addToast = useCallback((message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  const refreshData = useCallback(async (caseId: string, page: number = 1) => {
    try {
      const [caseInfo, txns, files] = await Promise.all([
        getCase(caseId),
        getTransactions(caseId, page, 250),
        getFileResults(caseId),
      ]);
      setCaseData(caseInfo);
      setTransactions(txns);
      setFileResultsList(files.files);

      // Fetch analysis in background
      setAnalysisLoading(true);
      getAnalysis(caseId)
        .then(ad => {
          setAnalysisData(ad);
          // Auto-switch to round trips tab if any found
          if (ad.round_trips.length > 0) {
            addToast(
              `Analysis complete: ${ad.round_trips.length} round-trip cycles, ${ad.suspicious_accounts.length} suspicious accounts detected`,
              'success'
            );
          }
        })
        .catch(err => console.error('Failed to get analysis:', err))
        .finally(() => setAnalysisLoading(false));
    } catch (err) {
      console.error('Failed to refresh data:', err);
    }
  }, [addToast]);

  const handleCreateCase = useCallback(async () => {
    setIsLoading(true);
    setLoadingMessage('Creating case...');
    setLoadingSubMessage('');
    try {
      const newCase = await createCase();
      setCaseData(newCase);
      setTransactions(null);
      setFileResultsList([]);
      setAnalysisData(null);
      addToast(`Case "${newCase.name}" created successfully`, 'success');
    } catch (err) {
      addToast(`Failed to create case: ${err}`, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [addToast]);

  const handleLoadDemo = useCallback(async () => {
    setIsLoading(true);
    setLoadingMessage('Loading demo case...');
    setLoadingSubMessage('Parsing the full local dataset across PDF, Excel, CSV, XLS, and TXT formats. Large PDFs may take a short moment.');
    try {
      const result = await loadDemoCase();
      addToast(
        `Demo loaded: ${result.files_succeeded}/${result.files_processed} files parsed, ${result.total_transactions.toLocaleString()} transactions extracted`,
        'success'
      );
      await refreshData(result.case_id);
    } catch (err) {
      addToast(`Failed to load demo: ${err}`, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [addToast, refreshData]);

  const handleUploadFiles = useCallback(async (files: File[]) => {
    if (!caseData) return;
    setIsLoading(true);
    setLoadingMessage(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`);
    setLoadingSubMessage('Extracting transactions from uploaded statements');
    try {
      const result = await uploadFiles(caseData.id, files);
      addToast(
        `${result.files_succeeded}/${result.files_processed} files parsed, ${result.new_transactions.toLocaleString()} new transactions`,
        result.files_failed > 0 ? 'error' : 'success'
      );
      await refreshData(caseData.id);
    } catch (err) {
      addToast(`Upload failed: ${err}`, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [caseData, addToast, refreshData]);

  const handlePageChange = useCallback(async (page: number) => {
    if (!caseData) return;
    try {
      const txns = await getTransactions(caseData.id, page, 250);
      setTransactions(txns);
    } catch (err) {
      console.error('Failed to change page:', err);
    }
  }, [caseData]);

  const handleDownloadExcel = useCallback(async () => {
    if (!caseData) return;
    try {
      await downloadExcel(caseData.id);
      addToast('Excel report downloaded successfully', 'success');
    } catch (err) {
      addToast(`Excel export failed: ${err}`, 'error');
    }
  }, [caseData, addToast]);

  const handleDownloadPdf = useCallback(async () => {
    if (!caseData) return;
    try {
      await downloadPdf(caseData.id);
      addToast('PDF report downloaded successfully', 'success');
    } catch (err) {
      addToast(`PDF export failed: ${err}`, 'error');
    }
  }, [caseData, addToast]);

  const hasData = !!(transactions || fileResultsList.length > 0);

  const tabs: { id: TabId; label: string; count?: string }[] = [
    { id: 'transactions', label: 'Transactions', count: transactions?.total?.toLocaleString() ?? '0' },
    { id: 'files', label: 'Files', count: String(fileResultsList.length) },
    { id: 'fundflow', label: 'Fund Flow', count: analysisData ? String(analysisData.fund_flow_summary.length) : '' },
    { id: 'roundtrips', label: 'Round Trips', count: analysisData ? String(analysisData.round_trips.length) : '' },
    { id: 'suspicious', label: 'Suspicious', count: analysisData ? String(analysisData.suspicious_accounts.length) : '' },
    { id: 'export', label: 'Export', count: '' },
  ];

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="app-logo">
          <div className="app-logo-icon">V</div>
          <span className="app-logo-text">VISTA</span>
          <span className="app-logo-version">v2.0</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {caseData && (
            <span className="badge badge-green" style={{ padding: '6px 14px' }}>
              Connected
            </span>
          )}
        </div>
      </header>

      {/* Dashboard Grid */}
      <div className="dashboard-grid">
        <CaseControl
          onLoadDemo={handleLoadDemo}
          onCreateCase={handleCreateCase}
          onUploadFiles={handleUploadFiles}
          isLoading={isLoading}
          hasCase={!!caseData}
        />
        <CaseDetails caseData={caseData} />
      </div>

      {/* Tab Bar */}
      {hasData && (
        <div className="tabs">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}{tab.count ? ` (${tab.count})` : ''}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {activeTab === 'transactions' && (
        <TransactionsTable
          data={transactions}
          onPageChange={handlePageChange}
          isLoading={false}
        />
      )}
      {activeTab === 'files' && (
        <FileResults files={fileResultsList} />
      )}
      {activeTab === 'fundflow' && (
        <FundFlowTable
          data={analysisData?.fund_flow_summary ?? []}
          isLoading={analysisLoading}
        />
      )}
      {activeTab === 'roundtrips' && (
        <RoundTripsTable
          data={analysisData?.round_trips ?? []}
          isLoading={analysisLoading}
        />
      )}
      {activeTab === 'suspicious' && (
        <SuspiciousAccounts
          data={analysisData?.suspicious_accounts ?? []}
          isLoading={analysisLoading}
        />
      )}
      {activeTab === 'export' && (
        <ExportPanel
          analysisData={analysisData}
          caseId={caseData?.id ?? null}
          onDownloadExcel={handleDownloadExcel}
          onDownloadPdf={handleDownloadPdf}
          isLoading={isLoading || analysisLoading}
        />
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div className="loading-overlay">
          <div className="loading-content">
            <div className="spinner"></div>
            <div className="loading-text">{loadingMessage}</div>
            {loadingSubMessage && (
              <div className="loading-subtext">{loadingSubMessage}</div>
            )}
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
