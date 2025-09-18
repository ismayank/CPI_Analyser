const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { analyzeRepoJsonChanges, parseIndustryTemplate } = require('./utils/gitAnalyzer');
const { generateReportPdf } = require('./utils/pdfGenerator');
const { flattenJsonDiff } = require('./utils/diffFlatten');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Return the sample industry-level JSON change template (.txt)
app.get('/api/template', (_req, res) => {
  // serve the new requested filename
  const templatePath = path.join(__dirname, 'templates', 'industry_change.txt');
  try {
    const content = fs.readFileSync(templatePath, 'utf8');
    res.type('text/plain').send(content);
  } catch (e) {
    res.status(500).json({ error: 'Template not found' });
  }
});

// Upload a local JSON file (industry template or diff) and return tables
// Form field: file (multipart/form-data)
app.post('/api/template/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const text = req.file.buffer.toString('utf8');
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = null; // will treat as template text
    }

    // Heuristic: if object has any _t or array entries in jsondiffpatch shape -> treat as delta
    const isDelta = (obj) => {
      if (!obj || typeof obj !== 'object') return false;
      if (obj._t === 'a') return true;
      return Object.values(obj).some((v) => Array.isArray(v) || (v && typeof v === 'object' && isDelta(v)));
    };

    // Case 1: Treat as industry template object (like P31, P463 arrays)
    if (json && typeof json === 'object' && !isDelta(json)) {
      // Let python_service create nice multi tables deterministically
      const resp = await fetch('http://python_service:8000/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: JSON.stringify(json), output: 'multi_tables' }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) return res.status(resp.status).json(data || { error: 'GenAI service error' });
      return res.json(data.result ? data : { result: data });
    }

    // Case 2: If we have a parsed JSON and it's a delta -> show only newly added entries
    if (json && typeof json === 'object') {
      const flat = flattenJsonDiff(json || {});
      const additions = flat.filter((r) => typeof r.before === 'undefined');
      const columns = ['Path', 'New Value'];
      const rows = additions.map((r) => [r.path, JSON.stringify(r.after)]);
      return res.json({ result: { title: 'Added JSON Entries', description: 'Only newly added keys/values from diff.', tables: [{ name: 'Added', columns, rows }] } });
    }

    // Case 3: Not JSON (likely .txt template). Send raw text to python_service for multi tables
    const resp = await fetch('http://python_service:8000/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: text, output: 'multi_tables' }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return res.status(resp.status).json(data || { error: 'GenAI service error' });
    return res.json(data.result ? data : { result: data });
  } catch (err) {
    console.error('template upload error', err);
    return res.status(500).json({ error: 'Failed to process uploaded file' });
  }
});

// Deterministic tables from report diffs (no AI)
// body: { report: { items: [...] } }
app.post('/api/tables/fromReport', async (req, res) => {
  try {
    const { report } = req.body || {};
    if (!report || !Array.isArray(report.items)) {
      return res.status(400).json({ error: 'report with items is required' });
    }

    // Flatten diffs into rows and group by file
    const byFile = new Map();
    for (const it of report.items) {
      const file = it.file;
      const flat = flattenJsonDiff(it.diff || {});
      for (const r of flat) {
        if (!byFile.has(file)) byFile.set(file, []);
        byFile.get(file).push({ path: r.path, before: r.before, after: r.after });
      }
    }

    const tables = [];
    for (const [file, rows] of byFile.entries()) {
      const tableRows = rows.map(r => [r.path, JSON.stringify(r.before), JSON.stringify(r.after)]);
      tables.push({ name: file, columns: ['Path', 'Old Value', 'New Value'], rows: tableRows });
    }

    return res.json({ tables });
  } catch (err) {
    console.error('tables fromReport error', err);
    return res.status(500).json({ error: 'Failed to build tables from report' });
  }
});

// Analyze repo: clone, diff last two commits for JSON files
// body: { repoUrl: string }
app.post('/api/analyzeRepo', async (req, res) => {
  const { repoUrl } = req.body || {};
  if (!repoUrl) return res.status(400).json({ error: 'repoUrl is required' });

  try {
    const report = await analyzeRepoJsonChanges(repoUrl);
    res.json(report);
  } catch (err) {
    console.error('analyzeRepo error', err);
    res.status(500).json({ error: err.message || 'Failed to analyze repository' });
  }
});

// Parse industry-level template text into structured JSON
// body: { text: string }
app.post('/api/parseTemplate', async (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text is required' });
  try {
    const parsed = parseIndustryTemplate(text);
    res.json(parsed);
  } catch (err) {
    console.error('parseTemplate error', err);
    res.status(500).json({ error: err.message || 'Failed to parse template' });
  }
});

// Generate PDF from report JSON (optionally include AI result)
// body: { report?: { ... }, ai?: any }
app.post('/api/generatePdf', async (req, res) => {
  let { report, ai } = req.body || {};
  // Allow AI-only PDFs by creating a minimal report scaffold
  if (!report) {
    report = { title: 'AI Documentation', items: [], generatedAt: new Date().toISOString() };
  }

  try {
    const doc = await generateReportPdf(report, ai);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="json-change-report.pdf"');
    doc.pipe(res);
    doc.end();
  } catch (err) {
    console.error('generatePdf error', err);
    res.status(500).json({ error: err.message || 'Failed to generate PDF' });
  }
});

// Proxy to Python GenAI microservice
// body: either { report: {...} } or { git_url: "..." }
app.post('/api/genai/generate', async (req, res) => {
  try {
    const resp = await fetch('http://python_service:8000/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return res.status(resp.status).json(data || { error: 'GenAI service error' });
    }
    return res.json(data);
  } catch (err) {
    console.error('genai proxy error', err);
    return res.status(500).json({ error: 'Failed to contact GenAI service' });
  }
});

// Generate AI table directly from an existing analysis report
// body: { report: { ... } }
app.post('/api/genai/fromReport', async (req, res) => {
  try {
    const { report } = req.body || {};
    if (!report || !Array.isArray(report.items)) {
      return res.status(400).json({ error: 'report with items is required' });
    }

    // Flatten diffs into rows of { file, path, before, after }
    const rows = [];
    for (const it of report.items) {
      const file = it.file;
      const delta = it.diff || {};
      const flat = flattenJsonDiff(delta);
      flat.forEach(r => rows.push({ file, path: r.path, before: r.before, after: r.after }));
    }

    // Prepare an input tailored for AI summary and deterministic tables
    const payload = {
      title: report.title || 'JSON Change Report',
      description: report.description || '',
      changes: rows,
    };

    const resp = await fetch('http://python_service:8000/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Ask Python service only for a concise summary; tables are deterministic from this endpoint
      body: JSON.stringify({ changes: payload.changes, title: payload.title, description: payload.description, output: 'summary' }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return res.status(resp.status).json(data || { error: 'GenAI service error' });
    }
    return res.json(data);
  } catch (err) {
    console.error('genai fromReport error', err);
    return res.status(500).json({ error: 'Failed to generate AI table from report' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
