import { useRef } from 'react';

interface CaseControlProps {
  onLoadDemo: () => void;
  onCreateCase: () => void;
  onUploadFiles: (files: File[]) => void;
  isLoading: boolean;
  hasCase: boolean;
}

export default function CaseControl({ onLoadDemo, onCreateCase, onUploadFiles, isLoading, hasCase }: CaseControlProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onUploadFiles(Array.from(files));
      e.target.value = '';
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Case control</span>
        <span className="badge badge-default">MVP ingestion</span>
      </div>
      <p className="card-subtitle">
        Upload PDF, Excel, CSV, or TXT statements and inspect normalized transactions immediately.
      </p>

      <div className="hero">
        <div className="hero-label">Offline-first financial investigation workspace</div>
        <h1 className="hero-title">
          Parse the full bank statement dataset into one clean evidence table.
        </h1>
        <p className="hero-description">
          The MVP uses deterministic local extraction, dedupe, reversal flags, balance review flags,
          and counterparty regex signals so every displayed row remains traceable to a source file.
        </p>
        <div className="btn-group">
          <button
            className="btn btn-accent"
            onClick={onLoadDemo}
            disabled={isLoading}
          >
            Load Full Dataset
          </button>
          <button
            className="btn btn-primary"
            onClick={onCreateCase}
            disabled={isLoading || hasCase}
          >
            Create Case
          </button>
          <button
            className="btn btn-primary"
            onClick={handleUploadClick}
            disabled={isLoading || !hasCase}
          >
            Upload Statements
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.xlsx,.xls,.csv,.txt"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      </div>
    </div>
  );
}
