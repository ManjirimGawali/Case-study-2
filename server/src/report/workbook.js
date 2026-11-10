// Result -> styled .xlsx (exceljs). Sheets: Summary, Verification, PF, ESIC, In ECR not in wagesheet, Data issues.
import ExcelJS from 'exceljs';
import { STATUSES } from '../verify/verdict.js';
import { CFG } from '../config.js';

const FILL = {
  MATCHED: 'FFDBEAFE', NAME_MISMATCH: 'FFFDE2E2', AMOUNT_MISMATCH: 'FFFFEDD5', MISSING: 'FFFECACA', NOT_APPLICABLE: 'FFF3F4F6',
};
const HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A0A0A' } };
const INR = '₹#,##0.##;[Red]-₹#,##0.##';

function header(ws, cols) {
  ws.columns = cols.map(([header, key, width]) => ({ header, key, width }));
  const r = ws.getRow(1);
  r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  r.fill = HEAD;
  r.alignment = { vertical: 'middle', wrapText: true };
  r.height = 30;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
}

function colour(cell, status) {
  if (FILL[status]) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[status] } };
  cell.font = { bold: true };
}

export async function buildWorkbook(result) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ECR Verifier';
  wb.created = new Date();

  // ---- Summary ----
  const s = wb.addWorksheet('Summary', { properties: { tabColor: { argb: 'FF1D4ED8' } } });
  s.columns = [{ width: 46 }, { width: 18 }, { width: 18 }, { width: 14 }];
  const add = (vals, style) => { const r = s.addRow(vals); if (style) Object.assign(r, style); return r; };
  add(['Wagesheet vs ECR verification'], { font: { bold: true, size: 15 } });
  add([`Files: ${result.meta.files.wagesheet} | ${result.meta.files.pf} | ${result.meta.files.esic}`]);
  add([`Wage month: PF ${result.meta.wageMonth.PF || '?'} · ESIC ${result.meta.wageMonth.ESIC || '?'} · Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`]);
  add([]);
  if (!result.reconciliation.ok) {
    const r = add([`⚠ ${result.reconciliation.failed} reconciliation check(s) FAILED — some ECR rows may not have been read; verdicts may be incomplete. See below.`]);
    r.font = { bold: true, color: { argb: 'FFB91C1C' } };
    add([]);
  }
  const hr = add(['Verdict', 'PF', 'ESIC']);
  hr.font = { bold: true, color: { argb: 'FFFFFFFF' } }; hr.fill = HEAD;
  for (const st of STATUSES) {
    const r = add([st, result.summary.PF.counts[st], result.summary.ESIC.counts[st]]);
    colour(r.getCell(1), st);
  }
  add(['Total employees', result.summary.PF.total, result.summary.ESIC.total]).font = { bold: true };
  add([]);
  const mr = add(['Money (₹)', 'PF', 'ESIC']);
  mr.font = { bold: true, color: { argb: 'FFFFFFFF' } }; mr.fill = HEAD;
  for (const [label, k] of [['Deducted per wagesheet', 'deducted'], ['Deposited (employees found in ECR)', 'deposited'], ['Short-deposited (missing + shortfalls)', 'shortfall']]) {
    const r = add([label, result.summary.PF[k], result.summary.ESIC[k]]);
    r.getCell(2).numFmt = INR; r.getCell(3).numFmt = INR;
  }
  add([]);
  const rh = add(['Reconciliation (parsed rows vs totals printed on the ECR)', 'Printed', 'Parsed', 'Result']);
  rh.font = { bold: true, color: { argb: 'FFFFFFFF' } }; rh.fill = HEAD;
  for (const c of result.reconciliation.checks) {
    const r = add([`${c.doc}: ${c.check}`, c.printed ?? '—', c.parsed, c.ok === null ? 'n/a' : c.ok ? '✔ OK' : '✖ FAILED']);
    if (c.ok === false) r.getCell(4).font = { bold: true, color: { argb: 'FFB91C1C' } };
  }
  add([]);
  add(['Rules used']).font = { bold: true };
  add([`Amounts equal if |ECR − wagesheet| ≤ ₹${CFG.AMOUNT_TOLERANCE} (statutory rounding)`]);
  add([`Names: exact / word order / spelling variants / honorifics / abbreviations accepted; partial names ${CFG.ALLOW_PARTIAL_NAMES ? 'accepted with a note' : 'rejected'}; initial-only matches ${CFG.ALLOW_INITIAL_ONLY ? 'accepted' : 'rejected'}; a shared common surname never counts as a match on its own`]);
  add(['PF name is compared with both "Name as per ECR" and "Name as per UAN Repository" (best match wins, shown in the detail)']);

  // ---- Verification (both authorities side by side) ----
  const v = wb.addWorksheet('Verification');
  header(v, [
    ['Name', 'name', 22], ['UAN', 'uan', 15], ['IP Number', 'ip', 13], ['Agency', 'agency', 20], ['State', 'state', 10],
    ['PF status', 'pfStatus', 18], ['PF reason', 'pfReason', 60], ['PF ECR name', 'pfEcrName', 22], ['PF name match', 'pfNameMatch', 12],
    ['PF deducted (WS)', 'pfDeducted', 12], ['PF deposited (EE)', 'pfDeposited', 12], ['PF difference', 'pfDiff', 12], ['PF expected from ECR wages', 'pfExpected', 14],
    ['ESIC status', 'esicStatus', 18], ['ESIC reason', 'esicReason', 60], ['ESIC ECR name', 'esicEcrName', 22], ['ESIC name match', 'esicNameMatch', 12],
    ['ESIC deducted (WS)', 'esicDeducted', 12], ['ESIC deposited (IP)', 'esicDeposited', 12], ['ESIC difference', 'esicDiff', 12], ['ESIC expected from ECR wages', 'esicExpected', 14],
    ['Notes', 'notes', 50],
  ]);
  for (const { emp, pf, esic } of result.employees) {
    const r = v.addRow({
      name: emp.name, uan: emp.uan, ip: emp.ip, agency: emp.agency, state: emp.state,
      pfStatus: pf.status, pfReason: pf.reason, pfEcrName: pf.ecrName, pfNameMatch: pf.nameMatch,
      pfDeducted: pf.deducted, pfDeposited: pf.deposited, pfDiff: pf.difference, pfExpected: pf.expected,
      esicStatus: esic.status, esicReason: esic.reason, esicEcrName: esic.ecrName, esicNameMatch: esic.nameMatch,
      esicDeducted: esic.deducted, esicDeposited: esic.deposited, esicDiff: esic.difference, esicExpected: esic.expected,
      notes: [...pf.notes.map((n) => `PF: ${n}`), ...esic.notes.map((n) => `ESIC: ${n}`)].join('; '),
    });
    colour(r.getCell('pfStatus'), pf.status);
    colour(r.getCell('esicStatus'), esic.status);
    for (const k of ['pfDeducted', 'pfDeposited', 'pfDiff', 'pfExpected', 'esicDeducted', 'esicDeposited', 'esicDiff', 'esicExpected']) r.getCell(k).numFmt = INR;
    r.alignment = { vertical: 'top', wrapText: true };
  }

  // ---- PF / ESIC separate ----
  for (const kind of ['PF', 'ESIC']) {
    const ws = wb.addWorksheet(kind);
    const idLabel = kind === 'PF' ? 'UAN' : 'IP Number';
    header(ws, [
      ['Name (wagesheet)', 'name', 22], [idLabel, 'id', 15], ['Status', 'status', 18], ['Reason', 'reason', 70],
      ['ECR name', 'ecrName', 22], ['Name match', 'nameMatch', 12], ['Name detail', 'nameDetail', 30],
      ['Deducted (WS)', 'deducted', 12], ['Deposited (ECR)', 'deposited', 12], ['Difference', 'difference', 12], ['Expected from ECR wages', 'expected', 14],
      ['ECR page', 'page', 8], ['Notes', 'notes', 40],
    ]);
    for (const e of result.employees) {
      const x = e[kind.toLowerCase()];
      const r = ws.addRow({ name: e.emp.name, id: x.id, status: x.status, reason: x.reason, ecrName: x.ecrName, nameMatch: x.nameMatch, nameDetail: x.nameDetail, deducted: x.deducted, deposited: x.deposited, difference: x.difference, expected: x.expected, page: x.page ?? '', notes: x.notes.join('; ') });
      colour(r.getCell('status'), x.status);
      for (const k of ['deducted', 'deposited', 'difference', 'expected']) r.getCell(k).numFmt = INR;
      r.alignment = { vertical: 'top', wrapText: true };
    }
  }

  // ---- Extras ----
  const ex = wb.addWorksheet('In ECR not in wagesheet');
  header(ex, [['Authority', 'kind', 10], ['UAN / IP Number', 'id', 16], ['Name in ECR', 'name', 26], ['Deposited', 'amount', 12], ['ECR page', 'page', 9]]);
  for (const e of result.extras) ex.addRow(e).getCell('amount').numFmt = INR;
  if (!result.extras.length) ex.addRow({ kind: 'None — every ECR row belongs to a wagesheet employee' });

  // ---- Data issues ----
  const di = wb.addWorksheet('Data issues');
  header(di, [['Source', 'source', 12], ['Row', 'row', 10], ['Name', 'name', 24], ['Issue', 'issue', 80]]);
  for (const d of result.dataIssues) di.addRow(d);
  if (!result.dataIssues.length) di.addRow({ source: 'None found' });

  return wb.xlsx.writeBuffer();
}

/** Flat CSV of the Verification sheet (for tools that can't read xlsx). */
export function toCsv(result) {
  const cols = ['name', 'uan', 'ip', 'pf_status', 'pf_reason', 'pf_deducted', 'pf_deposited', 'pf_difference', 'esic_status', 'esic_reason', 'esic_deducted', 'esic_deposited', 'esic_difference'];
  const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.join(',')];
  for (const { emp, pf, esic } of result.employees) {
    lines.push([emp.name, emp.uan, emp.ip, pf.status, pf.reason, pf.deducted, pf.deposited, pf.difference, esic.status, esic.reason, esic.deducted, esic.deposited, esic.difference].map(esc).join(','));
  }
  return lines.join('\n') + '\n';
}
