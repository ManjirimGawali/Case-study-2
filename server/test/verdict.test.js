// Verdict gates + amounts + ids (no PDFs needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdictFor } from '../src/verify/verdict.js';
import { compareAmounts, expectedPf, expectedEsic } from '../src/verify/amounts.js';
import { normId, isUan, isIp } from '../src/verify/ids.js';

const emp = (o = {}) => ({ name: 'VIKRAM THAKUR', uan: '999912340011', ip: '9912340011', pfAmount: 1654, esicAmount: 104, ...o });
const pfIdx = (rows) => new Map(rows.map((r) => [r.id, [r]]));
const pfRow = (o = {}) => ({ id: '999912340011', ecrName: 'VIKRAM THAKUR', uanName: 'VIKRAM THAKUR', epfWages: 13780, amount: 1654, page: 1, ...o });

test('MATCHED when id, name and amount agree', () => {
  assert.equal(verdictFor('PF', emp(), pfIdx([pfRow()]), isUan).status, 'MATCHED');
});
test('AMOUNT_MISMATCH shows both values, difference and the wage-based expectation', () => {
  const v = verdictFor('PF', emp(), pfIdx([pfRow({ amount: 1354 })]), isUan);
  assert.equal(v.status, 'AMOUNT_MISMATCH');
  assert.equal(v.difference, -300);
  assert.equal(v.expected, 1654);
  assert.match(v.reason, /short by ₹300/);
  assert.match(v.reason, /matches the wagesheet/);
});
test('±₹1 rounding is MATCHED with a note', () => {
  const v = verdictFor('PF', emp(), pfIdx([pfRow({ amount: 1655 })]), isUan);
  assert.equal(v.status, 'MATCHED');
  assert.match(v.reason, /rounding/);
});
test('NAME_MISMATCH takes precedence and still reports the amount gap', () => {
  const v = verdictFor('PF', emp(), pfIdx([pfRow({ ecrName: 'VIVEK THAKUR', uanName: 'VIVEK THAKUR', amount: 1000 })]), isUan);
  assert.equal(v.status, 'NAME_MISMATCH');
  assert.match(v.reason, /Amount also differs/);
});
test('PF accepts the UAN-repository name when the ECR name differs', () => {
  const v = verdictFor('PF', emp(), pfIdx([pfRow({ ecrName: 'V THAKUR' })]), isUan);
  assert.equal(v.status, 'MATCHED');
  assert.match(v.nameDetail, /UAN repository/);
});
test('MISSING when the id is not in the ECR, with the amount at risk', () => {
  const v = verdictFor('PF', emp(), pfIdx([]), isUan);
  assert.equal(v.status, 'MISSING');
  assert.match(v.reason, /₹1,654 deducted but not deposited/);
});
test('NOT_APPLICABLE when nothing was deducted and the id is absent', () => {
  const v = verdictFor('ESIC', emp({ esicAmount: 0 }), new Map(), isIp);
  assert.equal(v.status, 'NOT_APPLICABLE');
});
test('blank / malformed id in the wagesheet', () => {
  assert.equal(verdictFor('PF', emp({ uan: '' }), pfIdx([pfRow()]), isUan).status, 'MISSING');
  assert.match(verdictFor('PF', emp({ uan: '12345' }), pfIdx([pfRow()]), isUan).reason, /not a valid UAN/);
});
test('duplicate id in the ECR is noted', () => {
  const m = new Map([['999912340011', [pfRow(), pfRow()]]]);
  assert.match(verdictFor('PF', emp(), m, isUan).notes.join(), /appears 2 times/);
});

test('amount helpers', () => {
  assert.deepEqual(compareAmounts(86, 66), { equal: false, diff: -20 });
  assert.equal(compareAmounts(86, 85).equal, true);
  assert.equal(compareAmounts(null, 85).equal, false);
  assert.equal(expectedPf(13780), 1654);
  assert.equal(expectedEsic(11440), 86); // 85.8 rounds UP
  assert.equal(expectedEsic(13520), 102); // 101.4 -> 102
});

test('ids survive Excel formats', () => {
  assert.equal(normId(999912340001), '999912340001');
  assert.equal(normId('9.99912340001E+11'), '999912340001');
  assert.equal(normId('999912340001.0'), '999912340001');
  assert.equal(normId("'9912340001"), '9912340001');
  assert.equal(normId(' 9912 340 001 '), '9912340001');
  assert.equal(isUan('999912340001'), true);
  assert.equal(isUan('99991234000'), false);
  assert.equal(isIp('9912340001'), true);
});
