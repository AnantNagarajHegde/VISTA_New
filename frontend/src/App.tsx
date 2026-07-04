import { useState, useCallback } from 'react';
import CaseControl from './components/CaseControl';
import CaseDetails from './components/CaseDetails';
import TransactionsTable from './components/TransactionsTable';
import FileResults from './components/FileResults';
import {
  createCase,
  getCase,
  getTransactions,
  getFileResults,
  uploadFiles,
  loadDemoCase,
} from './api';
import type {
  CaseData,
  TransactionsResponse,
  FileResult,
} from './api';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

function App() {
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [transactions, setTransactions] = useState<TransactionsResponse | null>(null);
  const [fileResultsList, setFileResultsList] = useState<FileResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [loadingSubMessage, setLoadingSubMessage] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [activeTab, setActiveTab] = useState<'transactions' | 'files'>('transactions');

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
    } catch (err) {
      console.error('Failed to refresh data:', err);
    }
  }, []);

  const handleCreateCase = useCallback(async () => {
    setIsLoading(true);
    setLoadingMessage('Creating case...');
    setLoadingSubMessage('');
    try {
      const newCase = await createCase();
      setCaseData(newCase);
      setTransactions(null);
      setFileResultsList([]);
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

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="app-logo">
          <div className="app-logo-icon">V</div>
          <span className="app-logo-text">VISTA</span>
          <span className="app-logo-version">v1.0 MVP</span>
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
      {(transactions || fileResultsList.length > 0) && (
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'transactions' ? 'active' : ''}`}
            onClick={() => setActiveTab('transactions')}
          >
            Transactions ({transactions?.total.toLocaleString() ?? 0})
          </button>
          <button
            className={`tab ${activeTab === 'files' ? 'active' : ''}`}
            onClick={() => setActiveTab('files')}
          >
            Processed Files ({fileResultsList.length})
          </button>
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

