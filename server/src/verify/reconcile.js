// The parse proves itself: parsed rows are checked against the totals printed on each ECR.
// A failure doesn't stop the run — it is shown prominently so nobody trusts a partial parse by accident.
import { round2 } from './amounts.js';

const sum = (rows, k) => round2(rows.reduce((s, r) => s + (typeof r[k] === 'number' ? r[k] : 0), 0));

function check(doc, name, printed, parsed, tol = 0.5) {
  if (printed === null || printed === undefined) return { doc, check: name, printed: null, parsed, ok: null, note: 'not printed on this document' };
  return { doc, check: name, printed, parsed, ok: Math.abs(printed - parsed) <= tol };
}

export function reconcile(pf, esic) {
  const checks = [
    check('PF ECR', 'Member rows vs "Total Members"', pf.totals.members, pf.rows.length, 0),
    check('PF ECR', 'Σ EE share vs "Total EPF Contribution"', pf.totals.amount, sum(pf.rows, 'amount')),
    check('PF ECR', 'Σ EPS vs "Total EPS Contribution"', pf.totals.eps, sum(pf.rows, 'eps')),
    check('PF ECR', 'Σ ER vs "Total EPF-EPS Contribution"', pf.totals.er, sum(pf.rows, 'er')),
    check('ESIC ECR', 'Σ IP contribution vs "Total IP Contribution"', esic.totals.amount, sum(esic.rows, 'amount')),
    check('ESIC ECR', 'Σ wages vs "Total Monthly Wages"', esic.totals.wages, sum(esic.rows, 'wages')),
  ];
  const failed = checks.filter((c) => c.ok === false);
  return { checks, ok: failed.length === 0, failed: failed.length };
}
