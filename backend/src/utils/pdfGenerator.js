const PDFDocument = require('pdfkit');

function writeHeading(doc, text) {
  doc.fontSize(18).text(text, { underline: true });
  doc.moveDown(0.5);
}

function writeSubheading(doc, text) {
  doc.fontSize(14).text(text);
  doc.moveDown(0.2);
}

function writeParagraph(doc, text) {
  doc.fontSize(11).text(text);
  doc.moveDown(0.5);
}

function writeKeyValue(doc, key, value) {
  doc.fontSize(11).text(`${key}: ${value}`);
}

function stringify(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return String(obj);
  }
}

// ---- Table Rendering Helpers (for clean, uncluttered PDFs) ----
function drawTable(doc, { columns, rows, title }, opts = {}) {
  const startX = opts.x || doc.page.margins.left;
  let y = opts.y || doc.y;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const tableWidth = Math.min(opts.width || pageWidth, pageWidth);
  const paddingX = 6;
  const paddingY = 6;
  const headerBg = opts.headerBg || '#111827';
  const headerColor = opts.headerColor || '#e5e7eb';
  const rowBorder = opts.rowBorder || '#9aa2af33';
  const zebraBg = opts.zebraBg || '#94a3b81a';

  // Compute column widths (equal split by default)
  const colCount = columns.length;
  let colWidths = (opts.colWidths && opts.colWidths.length === colCount)
    ? opts.colWidths
    : Array(colCount).fill(Math.floor(tableWidth / colCount));
  // If colWidths are percentages (0..1), convert to px
  if (colWidths.every(w => w > 0 && w <= 1)) {
    colWidths = colWidths.map(w => Math.floor(w * tableWidth));
  }

  // Header background
  doc.save();
  doc.rect(startX, y, tableWidth, 22).fill(headerBg);
  doc.fillColor(headerColor).fontSize(10).font('Helvetica-Bold');
  let x = startX;
  for (let i = 0; i < colCount; i++) {
    doc.text(String(columns[i]), x + paddingX, y + paddingY, {
      width: colWidths[i] - paddingX * 2,
      ellipsis: true,
    });
    x += colWidths[i];
  }
  doc.restore();
  y += 22;

  // Rows
  doc.font('Helvetica').fontSize(10).fillColor('#e2e8f0');
  const footnotes = opts.footnotes || [];
  rows.forEach((row, idx) => {
    const isZebra = idx % 2 === 0;
    const cellHeights = [];
    x = startX;
    // Pre-measure wrapped height per cell
    for (let i = 0; i < colCount; i++) {
      const text = safeCellTruncated(row[i], footnotes, opts.maxCellLen || 140, title, idx, i, columns[i]);
      const h = measureTextHeight(doc, text, colWidths[i] - paddingX * 2);
      cellHeights.push(h + paddingY * 2);
    }
    const rowHeight = Math.max(20, Math.max(...cellHeights));

    if (isZebra) {
      doc.save();
      doc.rect(startX, y, tableWidth, rowHeight).fill(zebraBg);
      doc.restore();
    }

    // Cell texts
    for (let i = 0; i < colCount; i++) {
      const text = safeCellTruncated(row[i], footnotes, opts.maxCellLen || 140, title, idx, i, columns[i]);
      doc.fillColor('#e2e8f0').text(text, x + paddingX, y + paddingY, {
        width: colWidths[i] - paddingX * 2,
      });
      // vertical border
      doc.save();
      doc.strokeColor(rowBorder).lineWidth(0.5).moveTo(x + colWidths[i], y).lineTo(x + colWidths[i], y + rowHeight).stroke();
      doc.restore();
      x += colWidths[i];
    }
    // bottom border
    doc.save();
    doc.strokeColor(rowBorder).lineWidth(0.5).moveTo(startX, y + rowHeight).lineTo(startX + tableWidth, y + rowHeight).stroke();
    doc.restore();

    y += rowHeight;
    // Page break handling
    if (y > doc.page.height - doc.page.margins.bottom - 40) {
      doc.addPage();
      y = doc.y;
    }
  });
  doc.moveDown();
  return { y, footnotes };
}

function measureTextHeight(doc, text, width) {
  const prevY = doc.y;
  const prevX = doc.x;
  const prevPage = doc.page;
  const tmp = doc.heightOfString(String(text), { width });
  // restore (heightOfString doesn't mutate position, but keep structure comparable)
  doc.x = prevX; doc.y = prevY; doc.page = prevPage;
  return tmp;
}

function safeCell(v) {
  if (v === null || typeof v === 'undefined') return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function dequote(str) {
  if (typeof str !== 'string') return str;
  if (str.length >= 2 && str.startsWith('"') && str.endsWith('"')) {
    try {
      return JSON.parse(str);
    } catch {
      return str.slice(1, -1);
    }
  }
  return str;
}

function safeCellTruncated(v, footnotes, maxLen, tableName, rowIdx, colIdx, colName) {
  let text = safeCell(v);
  text = dequote(text);
  if (typeof text !== 'string') text = String(text);
  if (text.length > maxLen) {
    const short = text.slice(0, maxLen - 1) + '…';
    footnotes.push({ table: tableName || 'Table', row: rowIdx + 1, col: colName || colIdx + 1, full: text });
    return short;
  }
  return text;
}

// Flatten jsondiffpatch-like delta into rows { path, before, after }
function flattenDelta(delta) {
  const rows = [];
  function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
  function walk(d, path = []) {
    if (!isObj(d)) return;
    if (d._t === 'a') {
      Object.keys(d).forEach(k => {
        if (k === '_t') return;
        const entry = d[k];
        const idx = k.replace(/^_/, '');
        if (Array.isArray(entry)) {
          if (entry.length === 1) rows.push({ path: path.concat(idx).join('.'), before: undefined, after: entry[0] });
          else if (entry.length === 2) rows.push({ path: path.concat(idx).join('.'), before: entry[0], after: entry[1] });
          else if (entry.length >= 3 && entry[1] === 0 && entry[2] === 0) rows.push({ path: path.concat(idx).join('.'), before: entry[0], after: undefined });
        } else if (isObj(entry)) {
          walk(entry, path.concat(idx));
        }
      });
      return;
    }
    for (const key of Object.keys(d)) {
      if (key === '_t') continue;
      const val = d[key];
      if (Array.isArray(val)) {
        if (val.length === 2) rows.push({ path: path.concat(key).join('.'), before: val[0], after: val[1] });
        else if (val.length === 1) rows.push({ path: path.concat(key).join('.'), before: undefined, after: val[0] });
        else if (val.length >= 3 && val[1] === 0 && val[2] === 0) rows.push({ path: path.concat(key).join('.'), before: val[0], after: undefined });
      } else if (isObj(val)) {
        walk(val, path.concat(key));
      }
    }
  }
  walk(delta || {}, []);
  return rows;
}

async function generateReportPdf(report, ai) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });

  writeHeading(doc, report.title || 'JSON Change Report');
  if (report.description) writeParagraph(doc, report.description);

  writeSubheading(doc, 'Repository');
  writeKeyValue(doc, 'URL', report.repoUrl || 'N/A');

  doc.moveDown(0.5);
  writeSubheading(doc, 'Commit Range');
  writeKeyValue(doc, 'Previous', `${report.previous?.hash?.slice(0,7)} - ${report.previous?.message || ''}`);
  writeKeyValue(doc, 'Head', `${report.head?.hash?.slice(0,7)} - ${report.head?.message || ''}`);
  doc.moveDown(0.5);

  if (report.summary) {
    writeSubheading(doc, 'Summary');
    writeKeyValue(doc, 'Total JSON Files Changed', report.summary.totalJsonFilesChanged);
    writeKeyValue(doc, 'Added', report.summary.added);
    writeKeyValue(doc, 'Removed', report.summary.removed);
    writeKeyValue(doc, 'Modified', report.summary.modified);
    doc.moveDown(0.5);
  }

  if (Array.isArray(report.items)) {
    writeSubheading(doc, 'Changes');
    report.items.forEach((item, idx) => {
      doc.fontSize(12).text(`${idx + 1}. ${item.file} (${item.changeType || 'modified'})`);
      if (item.diff && Object.keys(item.diff).length > 0) {
        // Render a clean table Path | Old Value | New Value
        const rows = flattenDelta(item.diff).map(r => [r.path, r.before, r.after]);
        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const { footnotes } = drawTable(doc, { columns: ['Path', 'Old Value', 'New Value'], rows, title: item.file }, {
          colWidths: [0.45, 0.25, 0.30], // percentages
          maxCellLen: 140,
        });
        // If any values were truncated, add footnotes section after all items
        if (!doc._pdfFootnotes) doc._pdfFootnotes = [];
        doc._pdfFootnotes.push(...footnotes);
      } else {
        doc.fontSize(10).text('No structural JSON diff (possibly added/removed file).');
      }
      doc.moveDown(0.5);
    });
  }

  // Optional AI-generated documentation section
  if (ai) {
    doc.addPage();
    writeHeading(doc, 'AI-generated Documentation');
    if (typeof ai === 'string') {
      writeParagraph(doc, ai);
    } else if (typeof ai === 'object') {
      if (ai.title) writeSubheading(doc, ai.title);
      if (ai.description) writeParagraph(doc, ai.description);

      // If multiple tables are provided, render each nicely
      if (Array.isArray(ai.tables)) {
        ai.tables.forEach((t, idx) => {
          const name = t.name || `Table ${idx + 1}`;
          writeSubheading(doc, name);
          if (Array.isArray(t.columns) && Array.isArray(t.rows)) {
            const isRepoLike = JSON.stringify(t.columns).toLowerCase().includes('old value');
            const opts = isRepoLike ? { colWidths: [0.45, 0.25, 0.30], maxCellLen: 140 } : { maxCellLen: 140 };
            const { footnotes } = drawTable(doc, { columns: t.columns, rows: t.rows, title: name }, opts);
            if (!doc._pdfFootnotes) doc._pdfFootnotes = [];
            doc._pdfFootnotes.push(...footnotes);
          } else {
            doc.fontSize(9).text(stringify(t));
          }
        });
      }
      // Else, if a single table schema is provided, render it
      else if (ai.table && Array.isArray(ai.table.columns) && Array.isArray(ai.table.rows)) {
        const name = ai.table.name || 'Table';
        const isRepoLike = JSON.stringify(ai.table.columns).toLowerCase().includes('old value');
        const opts = isRepoLike ? { colWidths: [0.45, 0.25, 0.30], maxCellLen: 140 } : { maxCellLen: 140 };
        const { footnotes } = drawTable(doc, { columns: ai.table.columns, rows: ai.table.rows, title: name }, opts);
        if (!doc._pdfFootnotes) doc._pdfFootnotes = [];
        doc._pdfFootnotes.push(...footnotes);
      }
      // Else if a structured files array is provided, render in a readable tabular list
      else if (Array.isArray(ai.files)) {
        ai.files.forEach((f, idx) => {
          const fname = f.file || f.name || `File ${idx + 1}`;
          doc.fontSize(12).text(`${idx + 1}. ${fname}`);
          if (f.changeType) doc.fontSize(10).text(`Change: ${f.changeType}`);
          if (Array.isArray(f.changes) && f.changes.length) {
            doc.fontSize(10).text('Changes:');
            f.changes.forEach((c, j) => {
              const line = typeof c === 'string' ? c : stringify(c);
              doc.fontSize(9).text(`- ${line}`, { indent: 16 });
            });
          }
          if (f.notes) {
            const notes = typeof f.notes === 'string' ? f.notes : stringify(f.notes);
            doc.fontSize(10).text(`Notes: ${notes}`);
          }
          doc.moveDown(0.5);
        });
      } else {
        // Fallback: dump the JSON
        doc.fontSize(9).text(stringify(ai));
      }
    }
  }

  doc.moveDown(0.5);
  writeKeyValue(doc, 'Generated At', report.generatedAt || new Date().toISOString());

  // Append footnotes page if any truncated values exist
  if (doc._pdfFootnotes && doc._pdfFootnotes.length) {
    doc.addPage();
    writeHeading(doc, 'Appendix: Full Values');
    doc.fontSize(10).fillColor('#111');
    doc._pdfFootnotes.forEach((fn, i) => {
      doc.text(`${i + 1}. [${fn.table}] Row ${fn.row}, ${fn.col}: ${fn.full}`);
      doc.moveDown(0.1);
    });
  }

  return doc;
}

module.exports = { generateReportPdf };
