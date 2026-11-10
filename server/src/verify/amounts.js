// Amount comparison and "expected from ECR wages" evidence.
import { CFG } from '../config.js';

export const round2 = (v) => Math.round(v * 100) / 100;

/** diff = ECR - wagesheet (negative = short-deposited). equal if |diff| <= tolerance. */
export function compareAmounts(wagesheet, ecr) {
  if (wagesheet === null || wagesheet === undefined) return { equal: false, diff: null, reason: 'wagesheet amount blank' };
  if (ecr === null || ecr === undefined) return { equal: false, diff: null, reason: 'ECR amount blank' };
  const diff = round2(ecr - wagesheet);
  return { equal: Math.abs(diff) <= CFG.AMOUNT_TOLERANCE + 1e-9, diff };
}

/** EPFO: 12% of EPF wages, rounded to the nearest rupee. */
export const expectedPf = (epfWages) => (typeof epfWages === 'number' ? Math.round(epfWages * CFG.PF_RATE) : null);
/** ESIC: 0.75% of wages, rounded UP to the next rupee. */
export const expectedEsic = (wages) => (typeof wages === 'number' ? Math.ceil(round2(wages * CFG.ESIC_RATE) - 1e-9) : null);

export const inr = (v) => (v === null || v === undefined ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
