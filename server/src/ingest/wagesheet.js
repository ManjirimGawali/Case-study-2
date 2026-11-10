// Vendor wagesheet: .xlsx, .csv or PDF (the sample arrived as a PDF export of the Excel sheet).
// Columns are found by header NAME (with synonyms), never by position, and the header row may be anywhere in the first 30 rows.
import ExcelJS from 'exceljs';
import { extractTable, norm, toNumber } from './table.js';
import { normId } from '../verify/ids.js';

// key -> header regex (checked in this order; each header used once)
export const WAGESHEET_COLUMNS = {
  name: /^(EMPLOYEE |EMP |MEMBER |WORKER )?NAME$|^NAME OF (THE )?EMPLOYEE|^EMPLOYEE NAME/,
  uan: /^UAN( NO| NUMBER)?\.?$/,
  ip: /^IP (NO|NUMBER)|^ESIC (IP )?(NO|NUMBER)|INSURANCE (NO|NUMBER)/,
  agency: /AGENCY|VENDOR|CONTRACTOR/,
  state: /^STATE/,
  esic: /^ESIC|ESI @|ESIC EE|EMPLOYEE ESIC/,
  pf: /^(EPF|PF)( |$)|PF @|PF EE|EMPLOYEE PF|PROVIDENT/,
};
const REQUIRED = ['name', 'uan', 'ip', 'esic', 'pf'];
const SKIP_NAME = /^(GRAND )?TOTALS?$|^SUB ?TOTAL/;

export async function parseWagesheet(buffer, filename, pdf = null) {
  const lower = (filename || '').toLowerCase();
  let table;
  if (pdf) table = fromPdf(pdf);
  else if (lower.endsWith('.csv') || lower.endsWith('.txt')) table = fromGrid(csvToGrid(buffer.toString('utf8')));
  else table = fromGrid(await xlsxToGrid(buffer));

  const rows = [];
  for (const r of table.rows) {
    const name = String(r.name ?? '').replace(/\s+/g, ' ').trim();
    const blank = !name && !r.uan && !r.ip && !r.pf && !r.esic;
    if (blank || SKIP_NAME.test(norm(name))) continue;
    rows.push({
      rowNo: r._row,
      name,
      uan: normId(r.uan),
      ip: normId(r.ip),
      agency: String(r.agency ?? '').trim(),
      state: String(r.state ?? '').trim(),
      pfAmount: toNumber(r.pf),
      esicAmount: toNumber(r.esic),
    });
  }
  const missing = REQUIRED.filter((k) => !table.mapped.includes(k));
  if (missing.length) throw new Error(`Wagesheet: required column(s) not found: ${missing.join(', ')}. Headers seen: ${table.headers.join(' | ')}`);
  return { rows, headers: table.headers, warnings: table.warnings };
}

// ---------- grids (xlsx / csv) ----------
function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellText(v.result);
    if (v.text !== undefined) return String(v.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return v; // keep numbers as numbers (ids are normalised later)
}

async function xlsxToGrid(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  // first worksheet that looks like a wagesheet
  for (const ws of wb.worksheets) {
    const grid = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => { vals[c - 1] = cellText(cell.value); });
      grid[n - 1] = vals;
    });
    if (findHeaderRow(grid) >= 0) return grid;
  }
  throw new Error('Wagesheet: no sheet with Name / UAN / IP Number / ESIC / PF headers found');
}

function csvToGrid(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function mapHeader(cells) {
  const map = {};
  const used = new Set();
  for (const [key, re] of Object.entries(WAGESHEET_COLUMNS)) {
    const idx = cells.findIndex((c, i) => !used.has(i) && re.test(norm(c)));
    if (idx >= 0) { map[key] = idx; used.add(idx); }
  }
  return map;
}

function findHeaderRow(grid) {
  for (let i = 0; i < Math.min(grid.length, 30); i++) {
    const m = mapHeader((grid[i] || []).map((c) => String(c ?? '')));
    if (REQUIRED.filter((k) => k in m).length >= 4) return i;
  }
  return -1;
}

function fromGrid(grid) {
  const h = findHeaderRow(grid);
  if (h < 0) throw new Error('Wagesheet: header row (Name, UAN, IP Number, ESIC, PF) not found in the first 30 rows');
  const headerCells = grid[h].map((c) => String(c ?? ''));
  const map = mapHeader(headerCells);
  const rows = [];
  for (let i = h + 1; i < grid.length; i++) {
    const g = grid[i] || [];
    const r = { _row: i + 1 };
    for (const [k, idx] of Object.entries(map)) r[k] = g[idx];
    rows.push(r);
  }
  return { rows, mapped: Object.keys(map), headers: headerCells.filter(Boolean), warnings: [] };
}

// ---------- PDF ----------
function fromPdf(pdf) {
  const spec = {
    anchors: [/NAME/, /^UAN/],
    idKey: 'name',
    idPattern: /^[A-Za-z][A-Za-z.']+$/, // a data row has a name (blank-UAN rows must not be dropped)
    wrapKeys: ['agency'],
    columns: WAGESHEET_COLUMNS,
  };
  const t = extractTable(pdf.pages, spec);
  return {
    rows: t.rows.map((r, i) => ({ ...r, _row: `p${r._page}#${i + 1}` })),
    mapped: t.columns.map((c) => c.split('=')[0]).filter((k) => k !== '?'),
    headers: t.columns.map((c) => c.split('=')[1]),
    warnings: t.warnings,
  };
}
