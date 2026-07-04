import type { SuspiciousAccount } from '../api';

interface SuspiciousAccountsProps {
  data: SuspiciousAccount[];
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

function riskGlowClass(risk: string): string {
  switch (risk) {
    case 'CRITICAL': return 'sa-glow-red';
    case 'HIGH': return 'sa-glow-orange';
    case 'MEDIUM': return 'sa-glow-yellow';
    default: return '';
  }
}

export default function SuspiciousAccounts({ data, isLoading }: SuspiciousAccountsProps) {
  if (isLoading) {
    return (
      <div className="analysis-section">
        <div className="table-wrapper">
          <div className="empty-state">
            <div className="spinner" />
            <div className="loading-text">Analyzing account behavior…</div>
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
            <span className="analysis-title">Suspicious Accounts</span>
            <span className="analysis-count">0 flagged</span>
          </div>
        </div>
        <div className="table-wrapper">
          <div className="empty-state">
            <div className="empty-icon">🛡️</div>
            <div className="empty-text">No suspicious accounts detected</div>
            <div className="empty-subtext">All accounts appear normal based on current detection rules.</div>
          </div>
        </div>
      </div>
    );
  }

  const critical = data.filter(a => a.risk_level === 'CRITICAL').length;
  const high = data.filter(a => a.risk_level === 'HIGH').length;

  return (
    <div className="analysis-section">
      <div className="analysis-header">
        <div>
          <span className="analysis-title">Suspicious Accounts</span>
          <span className="analysis-count">{data.length} flagged</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {critical > 0 && <span className="badge badge-red">{critical} Critical</span>}
          {high > 0 && <span className="badge badge-orange">{high} High</span>}
        </div>
      </div>

      <div className="sa-grid">
        {data.map((acc) => (
          <div key={acc.account_id} className={`sa-card ${riskGlowClass(acc.risk_level)}`}>
            <div className="sa-card-header">
              <div className="sa-account-id" title={acc.account_id}>
                {acc.account_id}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {acc.is_primary && <span className="badge badge-blue">Primary</span>}
                <span className={`badge ${riskBadgeClass(acc.risk_level)}`}>{acc.risk_level}</span>
              </div>
            </div>

            <div className="sa-stats">
              <div className="sa-stat">
                <span className="sa-stat-label">Total In</span>
                <span className="amount-credit">{formatAmount(acc.total_in)}</span>
              </div>
              <div className="sa-stat">
                <span className="sa-stat-label">Total Out</span>
                <span className="amount-debit">{formatAmount(acc.total_out)}</span>
              </div>
              <div className="sa-stat">
                <span className="sa-stat-label">Net Flow</span>
                <span style={{ color: acc.net_flow >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                  {acc.net_flow >= 0 ? '+' : ''}{formatAmount(Math.abs(acc.net_flow))}
                </span>
              </div>
              <div className="sa-stat">
                <span className="sa-stat-label">Transactions</span>
                <span>{acc.tx_count}</span>
              </div>
            </div>

            <div className="sa-connections">
              <span className="sa-conn-badge">↓ {acc.fan_in} in</span>
              <span className="sa-conn-badge">↑ {acc.fan_out} out</span>
            </div>

            <div className="sa-reasons">
              {acc.reasons.map((reason, i) => (
                <div key={i} className="sa-reason">⚠ {reason}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
