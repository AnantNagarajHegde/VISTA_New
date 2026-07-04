const API_BASE = 'http://localhost:8000/api';

export interface CaseData {
  id: string;
  name: string;
  investigator: string;
  status: string;
  created_at: string;
  documents: number;
  transactions: number;
  alerts: number;
  needs_review: number;
  duplicates: number;
}

export interface Transaction {
  date: string | null;
  narration: string | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  source_file: string;
  row_number: number;
  account_no?: string | null;
  account_name?: string | null;
  tran_id?: string | null;
  tran_type?: string | null;
  counterparty_account?: string | null;
  ifsc?: string | null;
  upi_id?: string | null;
  is_reversed?: boolean;
  review_reasons?: string | null;
}

export interface TransactionsResponse {
  transactions: Transaction[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface FileResult {
  filename: string;
  success: boolean;
  transaction_count: number;
  error: string | null;
}

export interface UploadResponse {
  files_processed: number;
  files_succeeded: number;
  files_failed: number;
  new_transactions: number;
  total_transactions: number;
  results: FileResult[];
}

export interface DemoResponse {
  case_id: string;
  files_processed: number;
  files_succeeded: number;
  files_failed: number;
  total_transactions: number;
}

// --- Analysis Types ---

export interface FundFlowRow {
  source: string;
  destination: string;
  total_amount: number;
  transaction_count: number;
  date_range: string;
}

export interface RoundTripHop {
  from: string;
  to: string;
  amount: number;
  count: number;
  date_range: string;
}

export interface RoundTrip {
  cycle_path: string[];
  num_hops: number;
  total_amount: number;
  min_edge_amount: number;
  hops: RoundTripHop[];
  date_range: string;
  risk_score: string;
}

export interface MoneyTrailDest {
  date: string | null;
  narration: string;
  amount: number;
  destination: string;
  source_file: string;
}

export interface MoneyTrail {
  account: string;
  credit_date: string | null;
  credit_amount: number;
  credit_narration: string;
  credit_source: string;
  amount_traced: number;
  amount_untraced: number;
  destinations: MoneyTrailDest[];
}

export interface SuspiciousAccount {
  account_id: string;
  is_primary: boolean;
  total_in: number;
  total_out: number;
  net_flow: number;
  tx_count: number;
  fan_in: number;
  fan_out: number;
  reasons: string[];
  risk_level: string;
  risk_score: number;
}

export interface CaseSummary {
  total_transactions: number;
  total_source_files: number;
  total_primary_accounts: number;
  total_unique_accounts: number;
  date_range: string;
  total_debit: number;
  total_credit: number;
  round_trips_detected: number;
  suspicious_accounts_count: number;
  critical_accounts: number;
  high_risk_accounts: number;
  top_flows: FundFlowRow[];
}

export interface AnalysisData {
  summary: CaseSummary;
  round_trips: RoundTrip[];
  money_trail: MoneyTrail[];
  fund_flow_summary: FundFlowRow[];
  suspicious_accounts: SuspiciousAccount[];
}

// --- API Functions ---

export async function createCase(name: string = 'VISTA Case', investigator: string = 'Analyst'): Promise<CaseData> {
  const res = await fetch(`${API_BASE}/case/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, investigator }),
  });
  if (!res.ok) throw new Error(`Failed to create case: ${res.statusText}`);
  return res.json();
}

export async function getCase(caseId: string): Promise<CaseData> {
  const res = await fetch(`${API_BASE}/case/${caseId}`);
  if (!res.ok) throw new Error(`Failed to get case: ${res.statusText}`);
  return res.json();
}

export async function getTransactions(caseId: string, page: number = 1, pageSize: number = 250): Promise<TransactionsResponse> {
  const res = await fetch(`${API_BASE}/case/${caseId}/transactions?page=${page}&page_size=${pageSize}`);
  if (!res.ok) throw new Error(`Failed to get transactions: ${res.statusText}`);
  return res.json();
}

export async function getFileResults(caseId: string): Promise<{ files: FileResult[] }> {
  const res = await fetch(`${API_BASE}/case/${caseId}/files`);
  if (!res.ok) throw new Error(`Failed to get file results: ${res.statusText}`);
  return res.json();
}

export async function uploadFiles(caseId: string, files: File[]): Promise<UploadResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  const res = await fetch(`${API_BASE}/case/${caseId}/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error(`Failed to upload files: ${res.statusText}`);
  return res.json();
}

export async function loadDemoCase(): Promise<DemoResponse> {
  const res = await fetch(`${API_BASE}/case/demo`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to load demo case: ${res.statusText}`);
  return res.json();
}

export async function getAnalysis(caseId: string): Promise<AnalysisData> {
  const res = await fetch(`${API_BASE}/case/${caseId}/analysis`);
  if (!res.ok) throw new Error(`Failed to get analysis: ${res.statusText}`);
  return res.json();
}

export async function downloadExcel(caseId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/case/${caseId}/export/excel`);
  if (!res.ok) throw new Error(`Failed to download Excel: ${res.statusText}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `VISTA_Report_${caseId}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadPdf(caseId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/case/${caseId}/export/pdf`);
  if (!res.ok) throw new Error(`Failed to download PDF: ${res.statusText}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `VISTA_Report_${caseId}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
