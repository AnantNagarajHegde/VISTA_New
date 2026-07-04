import { useState, useMemo } from 'react';
import type { Transaction, TransactionsResponse } from '../api';

interface TransactionsTableProps {
  data: TransactionsResponse | null;
  onPageChange: (page: number) => void;
  isLoading: boolean;
}

function formatAmount(val: number | null): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '-';
  return val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(val: string | null): string {
  return val || '-';
}

function counterparty(txn: Transaction): string {
  return txn.counterparty_account || txn.upi_id || txn.ifsc || txn.account_no || '-';
}

function statusLabel(txn: Transaction): { label: string; className: string; title: string } {
  if (txn.is_reversed) {
    return { label: 'Reversal', className: 'badge-red', title: 'Transaction narration indicates reversal' };
  }
  if (txn.review_reasons) {
    return { label: 'Review', className: 'badge-yellow', title: txn.review_reasons };
  }
  return { label: 'Clean', className: 'badge-green', title: 'No deterministic quality flags' };
}

type SortField = 'date' | 'debit' | 'credit' | 'balance' | 'narration' | 'source_file' | 'status';
type SortDir = 'asc' | 'desc';

export default function TransactionsTable({ data, onPageChange, isLoading }: TransactionsTableProps) {
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [searchTerm, setSearchTerm] = useState('');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return ' ';
    return sortDir === 'asc' ? 'ASC' : 'DESC';
  };

  const filteredAndSorted = useMemo(() => {
    if (!data?.transactions) return [];
    let txns = [...data.transactions];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      txns = txns.filter(t =>
        (t.narration?.toLowerCase().includes(term)) ||
        (t.source_file?.toLowerCase().includes(term)) ||
        (t.date?.toLowerCase().includes(term)) ||
        (t.account_no?.toLowerCase().includes(term)) ||
        (t.account_name?.toLowerCase().includes(term)) ||
        (t.counterparty_account?.toLowerCase().includes(term)) ||
        (t.upi_id?.toLowerCase().includes(term)) ||
        (t.ifsc?.toLowerCase().includes(term)) ||
        (t.review_reasons?.toLowerCase().includes(term))
      );
    }

    txns.sort((a, b) => {
      let valA: string | number | null = null;
      let valB: string | number | null = null;

      switch (sortField) {
        case 'date':
          valA = a.date;
          valB = b.date;
          break;
        case 'debit':
          valA = a.debit;
          valB = b.debit;
          break;
        case 'credit':
          valA = a.credit;
          valB = b.credit;
          break;
        case 'balance':
          valA = a.balance;
          valB = b.balance;
          break;
        case 'narration':
          valA = a.narration;
          valB = b.narration;
          break;
        case 'source_file':
          valA = a.source_file;
          valB = b.source_file;
          break;
        case 'status':
          valA = a.review_reasons || (a.is_reversed ? 'reversal' : 'clean');
          valB = b.review_reasons || (b.is_reversed ? 'reversal' : 'clean');
          break;
      }

      if (valA === null && valB === null) return 0;
      if (valA === null) return 1;
      if (valB === null) return -1;

      const cmp = typeof valA === 'number' && typeof valB === 'number'
        ? valA - valB
        : String(valA).localeCompare(String(valB));

      return sortDir === 'asc' ? cmp : -cmp;
    });

    return txns;
  }, [data?.transactions, sortField, sortDir, searchTerm]);

  if (!data || data.total === 0) {
    return (
      <div className="transactions-section">
        <div className="transactions-header">
          <span className="transactions-title">Extracted Transactions</span>
        </div>
        <div className="table-wrapper">
          <div className="empty-state">
            <div className="empty-icon">VISTA</div>
            <div className="empty-text">No transactions yet</div>
            <div className="empty-subtext">Upload bank statements or load the full dataset to see extracted transactions.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="transactions-section">
      <div className="transactions-header">
        <div>
          <span className="transactions-title">Extracted Transactions</span>
          <span className="transactions-count" style={{ marginLeft: 12 }}>
            {data.total.toLocaleString()} total
            {searchTerm && ` - ${filteredAndSorted.length.toLocaleString()} matching this page`}
          </span>
        </div>
        <div className="search-bar">
          <input
            type="text"
            className="search-input"
            placeholder="Search narration, file, account, flag..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="table-wrapper">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th onClick={() => handleSort('date')}>Date {sortIndicator('date')}</th>
                <th onClick={() => handleSort('status')}>Status {sortIndicator('status')}</th>
                <th onClick={() => handleSort('narration')}>Narration {sortIndicator('narration')}</th>
                <th>Counterparty</th>
                <th onClick={() => handleSort('debit')}>Debit {sortIndicator('debit')}</th>
                <th onClick={() => handleSort('credit')}>Credit {sortIndicator('credit')}</th>
                <th onClick={() => handleSort('balance')}>Balance {sortIndicator('balance')}</th>
                <th onClick={() => handleSort('source_file')}>Source {sortIndicator('source_file')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '40px' }}>
                    <div className="spinner" style={{ margin: '0 auto' }}></div>
                  </td>
                </tr>
              ) : (
                filteredAndSorted.map((txn: Transaction, idx: number) => {
                  const status = statusLabel(txn);
                  return (
                    <tr key={`${txn.source_file}-${txn.row_number}-${idx}`}>
                      <td>{formatDate(txn.date)}</td>
                      <td>
                        <span className={`badge ${status.className}`} title={status.title}>{status.label}</span>
                      </td>
                      <td className="narration-cell" title={txn.narration ?? ''}>
                        {txn.narration || '-'}
                      </td>
                      <td className="source-file" title={counterparty(txn)}>{counterparty(txn)}</td>
                      <td className="amount-debit">{formatAmount(txn.debit)}</td>
                      <td className="amount-credit">{formatAmount(txn.credit)}</td>
                      <td className="amount-balance">{formatAmount(txn.balance)}</td>
                      <td className="source-file" title={txn.source_file}>{txn.source_file}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {data.total_pages > 1 && (
          <div className="pagination">
            <button
              className="pagination-btn"
              onClick={() => onPageChange(data.page - 1)}
              disabled={data.page <= 1}
            >
              Prev
            </button>
            <span className="pagination-info">
              Page {data.page} of {data.total_pages}
            </span>
            <button
              className="pagination-btn"
              onClick={() => onPageChange(data.page + 1)}
              disabled={data.page >= data.total_pages}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

