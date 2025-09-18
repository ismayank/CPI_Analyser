const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const simpleGit = require('simple-git');
const { diff: jsonDiff } = require('jsondiffpatch');

// Helper to safely parse JSON
function parseJsonSafe(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

// Parse industry-level template text into structured object
function parseIndustryTemplate(text) {
  // If the input is valid JSON, return it directly as parsed object
  try {
    const asJson = JSON.parse(text);
    return asJson;
  } catch (_) {
    // fall through to text template parsing
  }

  const lines = text.split(/\r?\n/);
  const data = { title: '', description: '', changes: [] };
  let section = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (/^Title\s*:/i.test(line)) {
      data.title = line.replace(/^Title\s*:/i, '').trim();
      section = null;
      continue;
    }
    if (/^Description\s*:/i.test(line)) {
      data.description = line.replace(/^Description\s*:/i, '').trim();
      section = null;
      continue;
    }
    if (/^Changes\s*:/i.test(line)) {
      section = 'changes';
      continue;
    }

    if (section === 'changes') {
      // Expect bullet items like: - file.json: Added key a.b, Modified key x.y
      const m = line.match(/^[-*]\s*(.+)$/);
      if (m) {
        data.changes.push(m[1]);
      }
    }
  }

  return data;
}

async function analyzeRepoJsonChanges(repoUrl) {
  const tmpDir = path.join(os.tmpdir(), `repo-${uuidv4()}`);
  const git = simpleGit();

  await git.clone(repoUrl, tmpDir, ['--depth', '50']);
  const repoGit = simpleGit(tmpDir);

  // Get last two commits
  const log = await repoGit.log({ n: 2 });
  if (!log || log.all.length < 2) {
    throw new Error('Repository must have at least 2 commits to compare.');
  }
  const [head, prev] = [log.all[0], log.all[1]];

  // Determine JSON files changed between the two commits
  const diffNameOnly = await repoGit.diff([`${prev.hash}`, `${head.hash}`, '--name-only', '--diff-filter=AMR']);
  const changedFiles = diffNameOnly
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(f => f.toLowerCase().endsWith('.json'));

  const items = [];

  for (const filePath of changedFiles) {
    let beforeStr = '';
    let afterStr = '';
    try {
      beforeStr = await repoGit.show(`${prev.hash}:${filePath}`);
    } catch (e) {
      // File may be added in head
      beforeStr = '';
    }
    try {
      afterStr = await repoGit.show(`${head.hash}:${filePath}`);
    } catch (e) {
      // File removed in head
      afterStr = '';
    }

    const beforeJson = beforeStr ? parseJsonSafe(beforeStr) : null;
    const afterJson = afterStr ? parseJsonSafe(afterStr) : null;

    let changeType = 'modified';
    if (!beforeStr && afterStr) changeType = 'added';
    if (beforeStr && !afterStr) changeType = 'removed';

    const diffObj = jsonDiff(beforeJson, afterJson) || {};

    items.push({
      file: filePath,
      changeType,
      diff: diffObj,
    });
  }

  const report = {
    title: 'JSON Change Report',
    description: `Changes between commits ${prev.hash.slice(0,7)} and ${head.hash.slice(0,7)}`,
    repoUrl,
    head: {
      hash: head.hash,
      message: head.message,
      author_name: head.author_name,
      date: head.date,
    },
    previous: {
      hash: prev.hash,
      message: prev.message,
      author_name: prev.author_name,
      date: prev.date,
    },
    items,
    summary: {
      totalJsonFilesChanged: items.length,
      added: items.filter(i => i.changeType === 'added').length,
      removed: items.filter(i => i.changeType === 'removed').length,
      modified: items.filter(i => i.changeType === 'modified').length,
    },
    generatedAt: new Date().toISOString(),
  };

  // Cleanup temporary directory
  try {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  } catch (_) {
    // ignore cleanup errors
  }

  return report;
}

module.exports = {
  analyzeRepoJsonChanges,
  parseIndustryTemplate,
};
