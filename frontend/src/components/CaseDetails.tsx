import type { CaseData } from '../api';

interface CaseDetailsProps {
  caseData: CaseData | null;
}

export default function CaseDetails({ caseData }: CaseDetailsProps) {
  const stats = [
    { label: 'Documents', value: caseData?.documents ?? 0, badge: 'uploaded', badgeClass: 'badge-green' },
    { label: 'Transactions', value: caseData?.transactions ?? 0, badge: 'normalized', badgeClass: 'badge-purple' },
    { label: 'Alerts', value: caseData?.alerts ?? 0, badge: 'findings', badgeClass: 'badge-orange' },
    { label: 'Needs review', value: caseData?.needs_review ?? 0, badge: 'validation', badgeClass: 'badge-yellow' },
  ];

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Case details</span>
        <span className="badge badge-default">
          status {caseData?.status ?? 'created'}
        </span>
      </div>
      <p className="card-subtitle">
        Keep the investigator context visible at all times.
      </p>

      <div className="input-row">
        <div className="input-group">
          <label className="input-label">Case name</label>
          <input
            type="text"
            className="input-field"
            value={caseData?.name ?? 'VISTA Case'}
            readOnly
          />
        </div>
        <div className="input-group">
          <label className="input-label">Investigator</label>
          <input
            type="text"
            className="input-field"
            value={caseData?.investigator ?? 'Analyst'}
            readOnly
          />
        </div>
      </div>

      <div className="stats-grid">
        {stats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className="stat-header">
              <span className="stat-label">{stat.label}</span>
              <span className={`badge ${stat.badgeClass}`}>{stat.badge}</span>
            </div>
            <div className="stat-value">
              {stat.value.toLocaleString()}
            </div>
          </div>
        ))}
        <div className="stat-card full-width">
          <div className="stat-header">
            <span className="stat-label">Duplicates</span>
            <span className="badge badge-green">deduped</span>
          </div>
          <div className="stat-value">
            {(caseData?.duplicates ?? 0).toLocaleString()}
          </div>
        </div>
      </div>

      <div className="case-footer">
        Current case: {caseData ? caseData.name : 'No case selected'}
      </div>
    </div>
  );
}
