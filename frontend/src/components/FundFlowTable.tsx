import { useState, useMemo } from 'react';
import type { FundFlowRow } from '../api';

interface FundFlowTableProps {
  data: FundFlowRow[];
  isLoading: boolean;
}

function formatAmount(val: number): string {
  if (val >= 10_000_000) return `₹${(val / 10_000_000).toFixed(2)} Cr`;
  if (val >= 100_000) return `₹${(val / 100_000).toFixed(2)} L`;
  return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function volumeClass(amount: number, maxAmount: number): string {
  const ratio = amount / (maxAmount || 1);
  if (ratio > 0.5) return 'volume-critical';
  if (ratio > 0.2) return 'volume-high';
  if (ratio > 0.05) return 'volume-medium';
  return 'volume-low';
}

type SortField = 'source' | 'destination' | 'total_amount' | 'transaction_count' | 'date_range';
type SortDir = 'asc' | 'desc';

export default function FundFlowTable({ data, isLoading }: FundFlowTableProps) {
  const [sortField, setSortField] = useState<SortField>('total_amount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [searchTerm, setSearchTerm] = useState('');

  const maxAmount = useMemo(() => Math.max(...data.map(d => d.total_amount), 1), [data]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'total_amount' || field === 'transaction_count' ? 'desc' : 'asc');
    }
  };

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const filtered = useMemo(() => {
    let rows = [...data];
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      rows = rows.filter(r =>
        r.source.toLowerCase().includes(term) ||
        r.destination.toLowerCase().includes(term) ||
        r.date_range.toLowerCase().includes(term)
      );
    }
    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'total_amount':
          cmp = a.total_amount - b.total_amount;
          break;
        case 'transaction_count':
          cmp = a.transaction_count - b.transaction_count;
          break;
        default:
          cmp = (a[sortField] || '').localeCompare(b[sortField] || '');
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [data, sortField, sortDir, searchTerm]);

  if (isLoading) {
    return (
      <div className="analysis-section">
        <div className="table-wrapper">
          <div className="empty-state">
            <div className="spinner" />
            <div className="loading-text">Computing fund flow analysis…</div>
          </div>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="analysis-section">
        <div className="table-wrapper">
          <div className="empty-state">
            <div className="empty-icon">💸</div>
            <div className="empty-text">No fund flow data</div>
            <div className="empty-subtext">Load a case with transactions to see fund flow analysis.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="analysis-section">
      <div className="analysis-header">
        <div>
          <span className="analysis-title">Fund Flow Summary</span>
          <span className="analysis-count">{filtered.length} account pairs</span>
        </div>
        <div className="search-bar">
          <input
            type="text"
            className="search-input"
            placeholder="Search accounts…"
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
                <th style={{ width: 40 }}>#</th>
                <th onClick={() => handleSort('source')}>Source Account{sortIndicator('source')}</th>
                <th style={{ width: 40, textAlign: 'center' }}></th>
                <th onClick={() => handleSort('destination')}>Destination Account{sortIndicator('destination')}</th>
                <th onClick={() => handleSort('total_amount')}>Total Amount{sortIndicator('total_amount')}</th>
                <th onClick={() => handleSort('transaction_count')}>Txns{sortIndicator('transaction_count')}</th>
                <th onClick={() => handleSort('date_range')}>Date Range{sortIndicator('date_range')}</th>
                <th>Volume</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => (
                <tr key={`${row.source}-${row.destination}-${idx}`}>
                  <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                  <td>
                    <span className="account-id" title={row.source}>{row.source}</span>
                  </td>
                  <td style={{ textAlign: 'center', color: 'var(--accent-orange)' }}>→</td>
                  <td>
                    <span className="account-id" title={row.destination}>{row.destination}</span>
                  </td>
                  <td className="amount-debit" style={{ fontWeight: 600 }}>
                    {formatAmount(row.total_amount)}
                  </td>
                  <td style={{ textAlign: 'center' }}>{row.transaction_count}</td>
                  <td style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>
                    {row.date_range || '-'}
                  </td>
                  <td>
                    <div className="volume-bar-container">
                      <div
                        className={`volume-bar ${volumeClass(row.total_amount, maxAmount)}`}
                        style={{ width: `${Math.max(4, (row.total_amount / maxAmount) * 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
