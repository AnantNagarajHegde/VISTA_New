import React, { useState } from 'react';
import type { RoundTrip } from '../api';

interface RoundTripsTableProps {
  data: RoundTrip[];
  isLoading: boolean;
}

function formatAmount(val: number): string {
  if (val >= 10_000_000) return `₹${(val / 10_000_000).toFixed(2)} Cr`;
  if (val >= 100_000) return `₹${(val / 100_000).toFixed(2)} L`;
  return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function riskBadgeClass(risk: string): string {
  switch (risk) {
    case 'CRITICAL': return 'badge-red';
    case 'HIGH': return 'badge-orange';
    case 'MEDIUM': return 'badge-yellow';
    default: return 'badge-default';
  }
}

export default function RoundTripsTable({ data, isLoading }: RoundTripsTableProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="analysis-section">
        <div className="table-wrapper">
          <div className="empty-state">
            <div className="spinner" />
            <div className="loading-text">Detecting round-trip cycles…</div>
          </div>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="analysis-section">
        <div className="analysis-header">
          <div>
            <span className="analysis-title">Round Trip Detection</span>
            <span className="analysis-count">0 cycles found</span>
          </div>
        </div>
        <div className="table-wrapper">
          <div className="empty-state">
            <div className="empty-icon">🔄</div>
            <div className="empty-text">No round-trip cycles detected</div>
            <div className="empty-subtext">
              No circular money movement patterns were found in the dataset.
              This could mean the minimum threshold wasn't met, or there are no cycles.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="analysis-section">
      <div className="analysis-header">
        <div>
          <span className="analysis-title">Round Trip Detection</span>
          <span className="analysis-count">{data.length} cycle{data.length !== 1 ? 's' : ''} detected</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="badge badge-red">{data.filter(d => d.risk_score === 'CRITICAL').length} Critical</span>
          <span className="badge badge-orange">{data.filter(d => d.risk_score === 'HIGH').length} High</span>
          <span className="badge badge-yellow">{data.filter(d => d.risk_score === 'MEDIUM').length} Medium</span>
        </div>
      </div>

      <div className="round-trips-list">
        {data.map((rt, idx) => {
          const isExpanded = expandedIdx === idx;
          return (
            <div key={idx} className={`rt-card ${isExpanded ? 'rt-expanded' : ''}`}>
              <div
                className="rt-card-header"
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
              >
                <div className="rt-card-main">
                  <span className="rt-number">#{idx + 1}</span>
                  <span className={`badge ${riskBadgeClass(rt.risk_score)}`}>{rt.risk_score}</span>
                  <span className="rt-path">
                    {rt.cycle_path.map((acc, i) => (
                      <span key={i}>
                        {i > 0 && <span className="rt-arrow">→</span>}
                        <span className="rt-account">{acc.length > 16 ? acc.slice(0, 14) + '…' : acc}</span>
                      </span>
                    ))}
                  </span>
                </div>
                <div className="rt-card-stats">
                  <span className="rt-amount">{formatAmount(rt.total_amount)}</span>
                  <span className="rt-hops">{rt.num_hops} hops</span>
                  <span className="rt-expand">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </div>

              {isExpanded && (
                <div className="rt-card-details">
                  <div className="rt-meta">
                    <span>Date Range: {rt.date_range || 'N/A'}</span>
                    <span>Min Edge: {formatAmount(rt.min_edge_amount)}</span>
                  </div>
                  <table className="rt-hops-table">
                    <thead>
                      <tr>
                        <th>From</th>
                        <th></th>
                        <th>To</th>
                        <th>Amount</th>
                        <th>Txns</th>
                        <th>Dates</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rt.hops.map((hop, hIdx) => (
                        <React.Fragment key={hIdx}>
                          <tr>
                            <td className="account-id" title={hop.from}>{hop.from}</td>
                            <td style={{ color: 'var(--accent-orange)', textAlign: 'center' }}>→</td>
                            <td className="account-id" title={hop.to}>{hop.to}</td>
                            <td className="amount-debit">{formatAmount(hop.amount)}</td>
                            <td style={{ textAlign: 'center' }}>{hop.count}</td>
                            <td style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>
                              {hop.date_range || '-'}
                            </td>
                          </tr>
                          {hop.matched_txns && hop.matched_txns.length > 0 && (
                            <tr className="rt-evidence-row" style={{ backgroundColor: 'var(--surface-sunken)' }}>
                              <td colSpan={6} style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
                                <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginBottom: 4 }}>
                                  <strong>Exact Evidence:</strong>
                                </div>
                                <ul style={{ listStyleType: 'none', padding: 0, margin: 0 }}>
                                  {hop.matched_txns.map((txn, tIdx) => (
                                    <li key={tIdx} style={{ marginBottom: 4, display: 'flex', gap: '16px' }}>
                                      <span style={{ minWidth: 80, color: 'var(--text-primary)' }}>{txn.date || '-'}</span>
                                      <span style={{ minWidth: 100, color: 'var(--accent-red)' }}>{formatAmount(txn.amount)}</span>
                                      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={txn.narration}>
                                        {txn.narration || '-'}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
