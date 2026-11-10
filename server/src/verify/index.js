// verify(inputs) -> the full result: per-employee PF and ESIC verdicts, summary, reconciliation, extras, data issues.
// Deterministic and side-effect free: the same inputs always give the same output.
import { verdictFor, STATUSES } from './verdict.js';
import { reconcile } from './reconcile.js';
import { isUan, isIp } from './ids.js';
import { round2 } from './amounts.js';

function indexBy(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.id, [...(m.get(r.id) || []), r]);
  return m;
}

export function verify({ wagesheet, pf, esic }) {
  const pfIndex = indexBy(pf.rows);
  const esicIndex = indexBy(esic.rows);
  const dataIssues = [];

  // duplicates inside the wagesheet
  const dupUan = dupes(wagesheet.rows.map((r) => r.uan).filter(Boolean));
  const dupIp = dupes(wagesheet.rows.map((r) => r.ip).filter(Boolean));

  const employees = wagesheet.rows.map((emp) => {
    const pfV = verdictFor('PF', emp, pfIndex, isUan);
    const esicV = verdictFor('ESIC', emp, esicIndex, isIp);
    if (dupUan.has(emp.uan)) pfV.notes.push(`UAN ${emp.uan} appears more than once in the wagesheet`);
    if (dupIp.has(emp.ip)) esicV.notes.push(`IP Number ${emp.ip} appears more than once in the wagesheet`);
    return { emp, pf: pfV, esic: esicV };
  });

  // data issues
  for (const { emp, pf: p, esic: e } of employees) {
    if (!emp.uan) dataIssues.push({ source: 'Wagesheet', row: emp.rowNo, name: emp.name, issue: 'UAN blank' });
    else if (!isUan(emp.uan)) dataIssues.push({ source: 'Wagesheet', row: emp.rowNo, name: emp.name, issue: `UAN "${emp.uan}" is not 12 digits` });
    if (!emp.ip) dataIssues.push({ source: 'Wagesheet', row: emp.rowNo, name: emp.name, issue: 'IP Number blank' });
    else if (!isIp(emp.ip)) dataIssues.push({ source: 'Wagesheet', row: emp.rowNo, name: emp.name, issue: `IP Number "${emp.ip}" has an unexpected length` });
    if (emp.pfAmount === null) dataIssues.push({ source: 'Wagesheet', row: emp.rowNo, name: emp.name, issue: 'PF amount blank' });
    if (emp.esicAmount === null) dataIssues.push({ source: 'Wagesheet', row: emp.rowNo, name: emp.name, issue: 'ESIC amount blank' });
    for (const n of [...p.notes, ...e.notes].filter((x) => /more than once|appears \d+ times/.test(x))) {
      dataIssues.push({ source: 'Duplicate', row: emp.rowNo, name: emp.name, issue: n });
    }
  }
  for (const w of [...(wagesheet.warnings || []), ...(pf.warnings || []), ...(esic.warnings || [])]) {
    dataIssues.push({ source: 'Parser', row: '', name: '', issue: w });
  }
  if (pf.wageMonth && esic.wageMonth && pf.wageMonth !== esic.wageMonth) {
    dataIssues.push({ source: 'Files', row: '', name: '', issue: `Wage months differ: PF ${pf.wageMonth} vs ESIC ${esic.wageMonth}` });
  }

  // ECR rows that belong to nobody in the wagesheet
  const wsUan = new Set(wagesheet.rows.map((r) => r.uan));
  const wsIp = new Set(wagesheet.rows.map((r) => r.ip));
  const extras = [
    ...pf.rows.filter((r) => !wsUan.has(r.id)).map((r) => ({ kind: 'PF', id: r.id, name: r.ecrName, amount: r.amount, page: r.page })),
    ...esic.rows.filter((r) => !wsIp.has(r.id)).map((r) => ({ kind: 'ESIC', id: r.id, name: r.ecrName, amount: r.amount, page: r.page })),
  ];

  return {
    employees,
    summary: { PF: summarise(employees.map((x) => x.pf)), ESIC: summarise(employees.map((x) => x.esic)) },
    reconciliation: reconcile(pf, esic),
    extras,
    dataIssues,
    meta: {
      wageMonth: { PF: pf.wageMonth, ESIC: esic.wageMonth },
      files: { wagesheet: wagesheet.file, pf: pf.file, esic: esic.file },
      counts: { wagesheet: wagesheet.rows.length, pf: pf.rows.length, esic: esic.rows.length, pfPages: pf.pages, esicPages: esic.pages },
    },
  };
}

function dupes(arr) {
  const seen = new Set(), d = new Set();
  for (const x of arr) (seen.has(x) ? d : seen).add(x);
  return d;
}

function summarise(vs) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const v of vs) counts[v.status]++;
  const deducted = round2(vs.reduce((s, v) => s + (v.deducted || 0), 0));
  const depositedMatched = round2(vs.reduce((s, v) => s + (v.deposited || 0), 0));
  const shortfall = round2(vs.reduce((s, v) => {
    if (v.status === 'MISSING') return s + (v.deducted || 0);
    if (typeof v.difference === 'number' && v.difference < 0 && v.status !== 'MATCHED') return s - v.difference;
    return s;
  }, 0));
  return { counts, total: vs.length, deducted, deposited: depositedMatched, shortfall };
}
