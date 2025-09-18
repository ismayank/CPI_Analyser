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
      doc.fontSize(12).text(`${idx + 1}. ${item.file} (${item.changeType})`);
      if (item.diff && Object.keys(item.diff).length > 0) {
        doc.fontSize(9).fillColor('#333');
        const json = stringify(item.diff);
        doc.text(json, { width: 520 });
        doc.fillColor('black');
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

      // If multiple tables are provided, render each with a heading
      if (Array.isArray(ai.tables)) {
        ai.tables.forEach((t, idx) => {
          const name = t.name || `Table ${idx + 1}`;
          writeSubheading(doc, name);
          if (Array.isArray(t.columns) && Array.isArray(t.rows)) {
            const cols = t.columns;
            doc.fontSize(11).text(cols.join('  |  '));
            doc.moveDown(0.2);
            doc.fontSize(10).text('-'.repeat(Math.min(100, cols.join('  |  ').length)));
            (t.rows || []).forEach((row) => {
              const vals = (row || []).map((v) => (v == null ? '' : String(v)));
              doc.fontSize(10).text(vals.join('  |  '));
            });
            doc.moveDown(0.5);
          } else {
            doc.fontSize(9).text(stringify(t));
          }
        });
      }
      // Else, if a single table schema is provided, render it
      else if (ai.table && Array.isArray(ai.table.columns) && Array.isArray(ai.table.rows)) {
        const cols = ai.table.columns;
        // Header
        doc.fontSize(11).text(cols.join('  |  '));
        doc.moveDown(0.2);
        doc.fontSize(10).text('-'.repeat(Math.min(100, cols.join('  |  ').length)));
        // Rows
        ai.table.rows.forEach((row) => {
          const vals = row.map((v) => (v == null ? '' : String(v)));
          doc.fontSize(10).text(vals.join('  |  '));
        });
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

  return doc;
}

module.exports = { generateReportPdf };
