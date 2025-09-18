// Utility to flatten a jsondiffpatch delta into simple change rows
// Each row: { path: 'a.b.c', before: <any>, after: <any> }

function isObject(x) {
  return x && typeof x === 'object' && !Array.isArray(x);
}

function clone(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch { return v; }
}

function pushChange(rows, pathArr, before, after) {
  rows.push({ path: pathArr.join('.'), before: clone(before), after: clone(after) });
}

function walkDelta(delta, pathArr, rows) {
  if (!isObject(delta)) return;

  // Array diffs have special marker _t === 'a'
  if (delta._t === 'a') {
    Object.keys(delta).forEach(key => {
      if (key === '_t') return;
      const entry = delta[key];
      const idx = key.replace(/^_/, '');
      if (Array.isArray(entry)) {
        // Added: [value]
        if (entry.length === 1) {
          pushChange(rows, pathArr.concat(idx), undefined, entry[0]);
        } else if (entry.length === 2) {
          // Modified (unlikely in array? kept for safety)
          pushChange(rows, pathArr.concat(idx), entry[0], entry[1]);
        } else if (entry.length >= 3) {
          // Removed: [old, 0, 0]
          if (entry[1] === 0 && entry[2] === 0) {
            pushChange(rows, pathArr.concat(idx), entry[0], undefined);
          }
        }
      } else if (isObject(entry)) {
        walkDelta(entry, pathArr.concat(idx), rows);
      }
    });
    return;
  }

  for (const key of Object.keys(delta)) {
    const val = delta[key];
    if (key === '_t') continue;

    if (Array.isArray(val)) {
      // Modified: [before, after]
      if (val.length === 2) {
        pushChange(rows, pathArr.concat(key), val[0], val[1]);
      } else if (val.length === 1) {
        // Added: [after]
        pushChange(rows, pathArr.concat(key), undefined, val[0]);
      } else if (val.length >= 3) {
        // Removed: [before, 0, 0]
        if (val[1] === 0 && val[2] === 0) {
          pushChange(rows, pathArr.concat(key), val[0], undefined);
        } else {
          // Fallback treat as modified
          pushChange(rows, pathArr.concat(key), val[0], val[1]);
        }
      }
    } else if (isObject(val)) {
      walkDelta(val, pathArr.concat(key), rows);
    }
  }
}

function flattenJsonDiff(delta) {
  const rows = [];
  walkDelta(delta || {}, [], rows);
  return rows;
}

module.exports = { flattenJsonDiff };
