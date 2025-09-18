import { useMemo, useState } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const API_BASE = useMemo(() => {
    // If VITE_API_BASE is set, use it. Otherwise, use relative requests so nginx can proxy /api to backend in Docker.
    return import.meta.env.VITE_API_BASE || '';
  }, []);

  const [repoUrl, setRepoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);
  const [templateText, setTemplateText] = useState('');
  const [templateFile, setTemplateFile] = useState(null);
  const [parsedTemplate, setParsedTemplate] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiResult, setAiResult] = useState(null);

  const analyzeRepo = async () => {
    setLoading(true);
    setError('');
    setReport(null);
    try {
      const { data } = await axios.post(`${API_BASE}/api/analyzeRepo`, { repoUrl });
      setReport(data);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to analyze repo');
    } finally {
      setLoading(false);
    }
  };

  const downloadAIPdf = async () => {
    if (!aiResult) return;
    try {
      const res = await axios.post(`${API_BASE}/api/generatePdf`, { ai: aiResult }, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'ai-documentation.pdf');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setAiError('Failed to download AI PDF');
    }
  };

  const onTemplateFileChange = (e) => {
    const f = e.target.files && e.target.files[0];
    setTemplateFile(f || null);
  };

  const uploadTemplateFile = async () => {
    if (!templateFile) return;
    setAiLoading(true);
    setAiError('');
    setAiResult(null);
    try {
      const form = new FormData();
      form.append('file', templateFile);
      const { data } = await axios.post(`${API_BASE}/api/template/upload`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setAiResult(data?.result ?? data);
    } catch (e) {
      setAiError(e?.response?.data?.error || e.message || 'File upload failed');
    } finally {
      setAiLoading(false);
    }
  };

  const generateAIFromTemplate = async () => {
    if (!templateText) return;
    setAiLoading(true);
    setAiError('');
    setAiResult(null);
    try {
      const { data } = await axios.post(`${API_BASE}/api/genai/generate`, { template: templateText, output: 'multi_tables' });
      setAiResult(data?.result ?? data);
    } catch (e) {
      setAiError(e?.response?.data?.error || e.message || 'AI generation failed');
    } finally {
      setAiLoading(false);
    }
  };

  const generateAI = async () => {
    if (!report) return;
    setAiLoading(true);
    setAiError('');
    setAiResult(null);
    try {
      const [tablesResp, summaryResp] = await Promise.all([
        axios.post(`${API_BASE}/api/tables/fromReport`, { report }),
        axios.post(`${API_BASE}/api/genai/fromReport`, { report }),
      ]);
      const tables = tablesResp?.data?.tables || [];
      const summary = summaryResp?.data?.result?.description || summaryResp?.data?.description || '';
      setAiResult({ description: summary, tables });
    } catch (e) {
      setAiError(e?.response?.data?.error || e.message || 'AI generation failed');
    } finally {
      setAiLoading(false);
    }
  };

  const loadTemplate = async () => {
    setError('');
    try {
      const res = await axios.get(`${API_BASE}/api/template`, { responseType: 'text' });
      setTemplateText(res.data);
    } catch (e) {
      setError('Failed to load template');
    }
  };

  const parseTemplate = async () => {
    setError('');
    try {
      const { data } = await axios.post(`${API_BASE}/api/parseTemplate`, { text: templateText });
      setParsedTemplate(data);
    } catch (e) {
      setError('Failed to parse template');
    }
  };

  const downloadPdf = async () => {
    if (!report) return;
    try {
      const payload = { report };
      if (aiResult) payload.ai = aiResult;
      const res = await axios.post(`${API_BASE}/api/generatePdf`, payload, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'json-change-report.pdf');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError('Failed to download PDF');
    }
  };

  return (
    <div className="container">
      <h1>CPI Analyzer</h1>
      <p>Enter a public GitHub or GitLab repo URL. The backend will compare the last two commits and diff JSON files.</p>

      <div className="panel">
        <label htmlFor="repoUrl">Repository URL</label>
        <input
          id="repoUrl"
          type="text"
          placeholder="https://github.com/owner/repo.git"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
        />
        <button onClick={analyzeRepo} disabled={!repoUrl || loading}>
          {loading ? 'Analyzing…' : 'Analyze Repo'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {report && (
        <div className="panel">
          <div className="panel-header">
            <h2>Report</h2>
            <div className="actions">
              <button onClick={downloadPdf}>Download PDF</button>
              <button onClick={generateAI} disabled={!report || aiLoading}>
                {aiLoading ? 'Generating AI…' : 'Generate AI Doc'}
              </button>
            </div>
          </div>
          <div className="meta">
            <div><strong>Repo:</strong> {report.repoUrl}</div>
            <div><strong>Range:</strong> {report.previous?.hash?.slice(0,7)} → {report.head?.hash?.slice(0,7)}</div>
            <div><strong>Summary:</strong> {report.summary?.totalJsonFilesChanged} files (added {report.summary?.added}, removed {report.summary?.removed}, modified {report.summary?.modified})</div>
          </div>

          <table className="changes-table">
            <thead>
              <tr>
                <th>#</th>
                <th>File</th>
                <th>Change</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {(report.items || []).map((item, idx) => (
                <tr key={idx}>
                  <td>{idx + 1}</td>
                  <td>{item.file}</td>
                  <td>{item.changeType}</td>
                  <td>
                    {item.diff && Object.keys(item.diff).length > 0 ? (
                      <pre className="diff-pre">{JSON.stringify(item.diff, null, 2)}</pre>
                    ) : (
                      <em>No structural JSON diff</em>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aiError && <div className="error">{aiError}</div>}

      {aiResult && (
        <div className="panel">
          <h2>AI-generated Documentation</h2>
          {typeof aiResult === 'object' && aiResult.description && (
            <p className="meta"><strong>Summary:</strong> {aiResult.description}</p>
          )}
          {typeof aiResult === 'object' && Array.isArray(aiResult.tables) && aiResult.tables.length > 0 && (
            <div>
              {aiResult.tables.map((t, idx) => (
                <div key={idx} style={{ marginBottom: 16 }}>
                  <h3 style={{ marginTop: 0 }}>{t.name || `Table ${idx + 1}`}</h3>
                  <table className="changes-table">
                    <thead>
                      <tr>
                        {(t.columns || []).map((col, i) => (
                          <th key={i}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(t.rows || []).map((row, rIdx) => (
                        <tr key={rIdx}>
                          {(row || []).map((cell, cIdx) => (
                            <td key={cIdx}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
          {typeof aiResult === 'object' && aiResult.table && Array.isArray(aiResult.table.columns) && Array.isArray(aiResult.table.rows) ? (
            <table className="changes-table">
              <thead>
                <tr>
                  {aiResult.table.columns.map((col, i) => (
                    <th key={i}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {aiResult.table.rows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : typeof aiResult === 'object' && Array.isArray(aiResult.files) ? (
            <table className="changes-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>File</th>
                  <th>Change</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {aiResult.files.map((f, idx) => (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td>{f.file || f.name || `File ${idx + 1}`}</td>
                    <td>{f.changeType || ''}</td>
                    <td>
                      {Array.isArray(f.changes) && f.changes.length ? (
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {f.changes.map((c, j) => (
                            <li key={j}>{typeof c === 'string' ? c : JSON.stringify(c)}</li>
                          ))}
                        </ul>
                      ) : f.notes ? (
                        <span>{typeof f.notes === 'string' ? f.notes : JSON.stringify(f.notes)}</span>
                      ) : (
                        <em>No details</em>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <pre className="diff-pre">{typeof aiResult === 'string' ? aiResult : JSON.stringify(aiResult, null, 2)}</pre>
          )}
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <h2>Industry-level Template</h2>
          <div className="actions">
            <button onClick={loadTemplate}>Load Sample</button>
            <button onClick={parseTemplate} disabled={!templateText}>Parse to JSON</button>
            <button onClick={generateAIFromTemplate} disabled={!templateText || aiLoading}>
              {aiLoading ? 'Formatting…' : 'AI Format to Table'}
            </button>
            <label className="upload-label">
              <input type="file" onChange={onTemplateFileChange} style={{ display: 'none' }} />
              <span className="btn">Choose File</span>
            </label>
            <button onClick={uploadTemplateFile} disabled={!templateFile || aiLoading}>
              {aiLoading ? 'Uploading…' : 'Upload & Generate Table'}
            </button>
            <button onClick={downloadAIPdf} disabled={!aiResult}>
              Download AI Doc
            </button>
          </div>
        </div>
        <textarea
          rows={8}
          placeholder="Paste or load the industry-level change template (.txt)"
          value={templateText}
          onChange={(e) => setTemplateText(e.target.value)}
        />

        {parsedTemplate && (
          <div className="panel">
            <h3>Parsed Template</h3>
            <pre className="diff-pre">{JSON.stringify(parsedTemplate, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
