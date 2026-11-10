// One verdict for one employee against one ECR. Pure function — unit-tested.
//
// Gates (first match wins):
//   1. identifier blank / malformed in wagesheet       -> MISSING (or NOT_APPLICABLE if nothing deducted)
//   2. identifier not in the ECR                        -> MISSING (or NOT_APPLICABLE if nothing deducted)
//   3. name does not match                              -> NAME_MISMATCH  (amounts still shown)
//   4. |ECR - wagesheet| > tolerance                    -> AMOUNT_MISMATCH (both values + difference)
//   5. otherwise                                        -> MATCHED (notes any name variant)
import { compareWithBest } from './names.js';
import { compareAmounts, expectedPf, expectedEsic, inr } from './amounts.js';

export const STATUSES = ['MATCHED', 'NAME_MISMATCH', 'AMOUNT_MISMATCH', 'MISSING', 'NOT_APPLICABLE'];

const AUTH = {
  PF: { idLabel: 'UAN', idKey: 'uan', amountKey: 'pfAmount', doc: 'PF ECR', amountLabel: 'EE share', rate: '12% of ECR EPF wages' },
  ESIC: { idLabel: 'IP Number', idKey: 'ip', amountKey: 'esicAmount', doc: 'ESIC ECR', amountLabel: 'IP contribution', rate: '0.75% of ECR wages' },
};

/**
 * @param {'PF'|'ESIC'} kind
 * @param {object} emp        wagesheet row
 * @param {Map<string, object[]>} index   ECR rows by id
 * @param {(id:string)=>boolean} validId
 */
export function verdictFor(kind, emp, index, validId) {
  const a = AUTH[kind];
  const id = emp[a.idKey];
  const deducted = emp[a.amountKey];
  const nothingDeducted = deducted === null || deducted === undefined || deducted === 0;
  const base = { kind, id, deducted, deposited: null, difference: null, ecrName: '', nameMatch: '', nameDetail: '', expected: null, notes: [] };

  if (!id) {
    return nothingDeducted
      ? { ...base, status: 'NOT_APPLICABLE', reason: `No ${a.idLabel} in wagesheet and nothing deducted` }
      : { ...base, status: 'MISSING', reason: `No ${a.idLabel} in wagesheet, but ${inr(deducted)} was deducted — cannot be traced to the ${a.doc}` };
  }
  if (!validId(id)) {
    return { ...base, status: 'MISSING', reason: `${a.idLabel} "${id}" in wagesheet is not a valid ${a.idLabel} — fix the wagesheet` };
  }
  const hits = index.get(id) || [];
  if (!hits.length) {
    return nothingDeducted
      ? { ...base, status: 'NOT_APPLICABLE', reason: `${a.idLabel} not in ${a.doc}; nothing was deducted in the wagesheet` }
      : { ...base, status: 'MISSING', reason: `${a.idLabel} ${id} not found in ${a.doc} — ${inr(deducted)} deducted but not deposited` };
  }
  const ecr = hits[0];
  const notes = [];
  if (hits.length > 1) notes.push(`${a.idLabel} appears ${hits.length} times in the ${a.doc}; first row used`);

  const candidates = kind === 'PF' ? [['ECR name', ecr.ecrName], ['UAN repository name', ecr.uanName]] : [['ECR name', ecr.ecrName]];
  const name = compareWithBest(emp.name, candidates);
  if (kind === 'PF' && ecr.uanName && ecr.ecrName && ecr.uanName.toUpperCase() !== ecr.ecrName.toUpperCase()) {
    notes.push(`PF ECR name "${ecr.ecrName}" differs from UAN repository name "${ecr.uanName}"`);
  }
  const expected = kind === 'PF' ? expectedPf(ecr.epfWages) : expectedEsic(ecr.wages);
  const amt = compareAmounts(deducted, ecr.amount);
  if (ecr.reason) notes.push(`ESIC reason: ${ecr.reason}`);
  if (ecr.disabled) notes.push(`ESIC "Is Disable": ${ecr.disabled}`);

  const out = {
    ...base,
    deposited: ecr.amount,
    difference: amt.diff,
    ecrName: name.ecrName || ecr.ecrName,
    nameMatch: name.type,
    nameDetail: name.against && name.against !== 'ECR name' ? `${name.detail ? name.detail + '; ' : ''}matched ${name.against}` : name.detail,
    expected,
    page: ecr.page,
    notes,
  };
  const amountText = amountSentence(a, deducted, ecr.amount, amt, expected);

  if (!name.match) {
    return {
      ...out, status: 'NAME_MISMATCH',
      reason: `${a.idLabel} found but name differs: wagesheet "${emp.name}" vs ECR "${out.ecrName}" (${name.detail})${amt.equal ? '' : `. Amount also differs: ${amountText}`}`,
    };
  }
  if (!amt.equal) return { ...out, status: 'AMOUNT_MISMATCH', reason: amountText };

  const extra = [];
  if (name.type === 'VARIANT') extra.push(`name variant (${out.nameDetail})`);
  if (name.type === 'PARTIAL') extra.push(`name partially matches (${out.nameDetail})`);
  if (amt.diff) extra.push(`rounding difference ${inr(amt.diff)} within tolerance`);
  return { ...out, status: 'MATCHED', reason: `Matched${extra.length ? ' — ' + extra.join('; ') : ''}` };
}

function amountSentence(a, deducted, deposited, amt, expected) {
  if (amt.diff === null) return `${amt.reason} (deducted ${inr(deducted)}, deposited ${inr(deposited)})`;
  const dir = amt.diff < 0 ? `short by ${inr(-amt.diff)}` : `excess ${inr(amt.diff)}`;
  let s = `Deposited ${inr(deposited)} (${a.amountLabel}) vs deducted ${inr(deducted)} — ${dir}`;
  if (expected !== null) {
    const who = Math.abs(expected - deducted) <= 1 ? 'matches the wagesheet' : Math.abs(expected - deposited) <= 1 ? 'matches the deposit' : 'matches neither';
    s += `. ${a.rate} = ${inr(expected)} (${who})`;
  }
  return s;
}
