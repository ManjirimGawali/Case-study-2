// Header-driven table extraction from positioned PDF lines.
// Nothing here knows about PF or ESIC: a "spec" says which header labels to look for and how to recognise a data row.
//
// How it works (per page):
//   1. find the header line (a line that contains the spec's anchor labels)
//   2. merge header fragments printed on the line(s) just above it ("Name as per" + "UAN Repository")
//   3. cells -> columns by header overlap; right-aligned numbers by their right edge; else nearest header centre
//   4. every later line is split into cells by x-centre; it is a data row only if its ID cell has the right shape
//   5. a continuation page without a header reuses the previous page's columns
//   6. a line with no ID that only has text in the name column is a wrapped name -> appended to the previous row

const HEADER_MERGE_PT = 16; // header fragments up to this far above the header line belong to it

export const norm = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9@%.]+/g, ' ').trim();

/**
 * @param {Array} pages            from readPdf()
 * @param {object} spec
 * @param {RegExp[]} spec.anchors  every anchor must match some item on the header line
 * @param {Object<string, RegExp>} spec.columns  key -> regex on the (merged, normalised) header label
 * @param {string} spec.idKey      column whose value identifies a data row
 * @param {RegExp} spec.idPattern  shape of a valid id (digits only, after stripping spaces)
 * @param {string[]} [spec.wrapKeys] columns whose text may wrap onto the next line (e.g. names)
 * @returns {{rows: Array<object>, headersFound: number, columns: string[], warnings: string[]}}
 */
export function extractTable(pages, spec) {
  const rows = [];
  const warnings = [];
  let cols = null;
  let headersFound = 0;
  let lastRow = null;

  for (const page of pages) {
    const lines = page.lines;
    let start = 0;
    const h = findHeader(lines, spec);
    if (h) {
      cols = h.cols;
      start = h.next;
      headersFound++;
    } else if (!cols) {
      continue; // nothing recognisable yet (cover page etc.)
    }
    for (let i = start; i < lines.length; i++) {
      const cells = splitCells(lines[i], cols);
      const rawId = (cells[spec.idKey] || '').replace(/\s+/g, '');
      if (spec.idPattern.test(rawId)) {
        lastRow = { ...mapKeys(cells, cols, spec), _page: page.num, _y: Math.round(lines[i].y) };
        rows.push(lastRow);
        continue;
      }
      // wrapped text (long names): a line with no ID whose only text sits in wrap columns, directly under the previous row
      const wrapKeys = spec.wrapKeys || [];
      if (wrapKeys.length && lastRow && lastRow._page === page.num && lastRow._y - lines[i].y < 14) {
        const mapped = mapKeys(cells, cols, spec);
        const filled = Object.keys(mapped).filter((k) => mapped[k]);
        if (filled.length && filled.every((k) => wrapKeys.includes(k))) {
          for (const k of filled) lastRow[k] = `${lastRow[k] || ''} ${mapped[k]}`.trim();
          lastRow._y = Math.round(lines[i].y);
        }
      }
    }
  }
  const missing = cols ? Object.keys(spec.columns).filter((k) => !cols.some((c) => c.key === k)) : Object.keys(spec.columns);
  if (missing.length) warnings.push(`Columns not found: ${missing.join(', ')}`);
  return { rows, headersFound, columns: cols ? cols.map((c) => `${c.key || '?'}=${c.label}`) : [], warnings };
}

function findHeader(lines, spec) {
  for (let i = 0; i < lines.length; i++) {
    const labels = lines[i].items.map((it) => norm(it.s));
    if (!spec.anchors.every((re) => labels.some((l) => re.test(l)))) continue;
    // merge header fragments printed just above OR just below the anchor line (multi-line headers:
    // "Name as per" over "UAN Repository", or "Gross" over "Wages" — PDFs differ in which line has the anchors)
    const cols = lines[i].items.map((it) => ({ x0: it.x0, x1: it.x1, label: it.s }));
    const isWordLine = (l) => l.items.every((it) => !/^[\d,.\-]+$/.test(it.s));
    const merge = (l, below) => {
      for (const it of l.items) {
        const col = cols.find((cl) => it.x0 < cl.x1 && cl.x0 < it.x1);
        if (col) { col.label = below ? `${col.label} ${it.s}` : `${it.s} ${col.label}`; col.x0 = Math.min(col.x0, it.x0); col.x1 = Math.max(col.x1, it.x1); }
        else cols.push({ x0: it.x0, x1: it.x1, label: it.s });
      }
    };
    for (const l of lines.slice(Math.max(0, i - 3), i)) {
      if (l.y > lines[i].y && l.y - lines[i].y <= HEADER_MERGE_PT && isWordLine(l)) merge(l, false);
    }
    let next = i + 1;
    while (next < lines.length && lines[i].y - lines[next].y <= HEADER_MERGE_PT && isWordLine(lines[next])) {
      merge(lines[next], true);
      next++;
    }
    cols.sort((a, b) => a.x0 - b.x0);
    for (const c of cols) {
      c.cx = (c.x0 + c.x1) / 2;
      c.norm = norm(c.label);
    }
    // boundaries at midpoints between neighbouring header centres
    for (let k = 0; k < cols.length; k++) {
      cols[k].lo = k === 0 ? -Infinity : (cols[k - 1].cx + cols[k].cx) / 2;
      cols[k].hi = k === cols.length - 1 ? Infinity : (cols[k].cx + cols[k + 1].cx) / 2;
    }
    // map spec keys to columns (each column used once, first matching key wins in spec order)
    const used = new Set();
    for (const [key, re] of Object.entries(spec.columns)) {
      const col = cols.find((cl) => !used.has(cl) && re.test(cl.norm));
      if (col) { col.key = key; used.add(col); }
    }
    return { index: i, next, cols };
  }
  return null;
}

const NUMERIC = /^-?[\d,]+(\.\d+)?$/;

/**
 * Assign each text item to a column:
 *   1. the column whose header x-range overlaps the item most (works for left/centre alignment and most numbers)
 *   2. no overlap + numeric -> right-aligned: the column whose header starts at/before the item's right edge
 *      and whose neighbour starts after it (a right-aligned number ends inside its own column's span)
 *   3. otherwise -> nearest header centre (midpoint boundaries)
 */
function columnFor(it, cols) {
  let best = null, bestOv = 0;
  for (const c of cols) {
    const ov = Math.min(it.x1, c.x1) - Math.max(it.x0, c.x0);
    if (ov > bestOv) { bestOv = ov; best = c; }
  }
  if (best) return best;
  if (NUMERIC.test(it.s)) {
    for (let k = cols.length - 1; k >= 0; k--) if (cols[k].x0 <= it.x1) return cols[k];
  }
  return cols.find((c) => it.cx >= c.lo && it.cx < c.hi) || null;
}

function splitCells(line, cols) {
  const cells = {};
  for (const it of line.items) {
    const col = columnFor(it, cols);
    if (!col) continue;
    const k = col.key || `_${col.norm}`;
    cells[k] = cells[k] ? `${cells[k]} ${it.s}` : it.s;
  }
  return cells;
}

function mapKeys(cells, cols, spec) {
  const out = {};
  for (const k of Object.keys(spec.columns)) out[k] = cells[k] ?? '';
  return out;
}

/**
 * Find a printed total such as "Total Members 11" (value to the right on the same line)
 * or ESIC style (label on one line, value directly below).
 */
export function findTotal(pages, labelRe) {
  for (const page of pages) {
    const lines = page.lines;
    for (let i = 0; i < lines.length; i++) {
      for (const it of lines[i].items) {
        if (!labelRe.test(norm(it.s))) continue;
        const right = lines[i].items.find((o) => o.x0 > it.x1 - 1 && /^-?[\d,]+(\.\d+)?$/.test(o.s));
        if (right) return toNumber(right.s);
        for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
          const below = lines[j].items.find((o) => o.x0 < it.x1 && it.x0 < o.x1 && /^-?[\d,]+(\.\d+)?$/.test(o.s));
          if (below) return toNumber(below.s);
        }
      }
    }
  }
  return null;
}

export function toNumber(s) {
  if (s === null || s === undefined) return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const t = String(s).replace(/[₹,\s]/g, '').replace(/^Rs\.?/i, '');
  if (t === '' || t === '-') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}
