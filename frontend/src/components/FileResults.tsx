import type { FileResult } from '../api';

interface FileResultsProps {
  files: FileResult[];
}

export default function FileResults({ files }: FileResultsProps) {
  if (files.length === 0) return null;

  const succeeded = files.filter(f => f.success).length;
  const failed = files.filter(f => !f.success).length;
  const totalTxns = files.reduce((sum, f) => sum + f.transaction_count, 0);

  return (
    <div className="file-results">
      <div className="transactions-header">
        <div>
          <span className="transactions-title">Processed Files</span>
          <span className="transactions-count" style={{ marginLeft: 12 }}>
            {files.length} files - {succeeded} succeeded - {failed} failed - {totalTxns.toLocaleString()} transactions
          </span>
        </div>
      </div>
      <div className="file-results-grid">
        {files.map((file, idx) => (
          <div className="file-result-card" key={`${file.filename}-${idx}`}>
            <div className={`file-icon ${file.success ? 'success' : 'failed'}`}>
              {file.success ? 'OK' : 'ERR'}
            </div>
            <div className="file-info">
              <div className="file-name" title={file.filename}>{file.filename}</div>
              <div className="file-meta">
                {file.success
                  ? `${file.transaction_count.toLocaleString()} transactions`
                  : file.error || 'Extraction failed'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
