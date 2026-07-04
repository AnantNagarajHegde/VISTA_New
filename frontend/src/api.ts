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

export interface FlowAccount {
  id: string;
  label: string;
  type: 'primary' | 'counterparty';
  transaction_count: number;
  total_debit: number;
  total_credit: number;
}

export interface FlowEdge {
  source: string;
  target: string;
  amount: number;
  count: number;
}

export interface FlowData {
  accounts: FlowAccount[];
  edges: FlowEdge[];
  total_accounts: number;
  total_edges: number;
}

export async function getFlowData(caseId: string): Promise<FlowData> {
  const res = await fetch(`${API_BASE}/case/${caseId}/flow`);
  if (!res.ok) throw new Error(`Failed to get flow data: ${res.statusText}`);
  return res.json();
}
