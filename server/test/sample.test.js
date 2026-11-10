// End-to-end acceptance test on the provided sample files: must reproduce the hand-worked expected verdicts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVerification } from '../src/run.js';
import { buildWorkbook } from '../src/report/workbook.js';
import { detectKind } from '../src/ingest/index.js';
import ExcelJS from 'exceljs';

const TD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-data');
const f = (n) => ({ name: n, buffer: fs.readFileSync(path.join(TD, n)) });
const FILES = { wagesheet: f('Sample_Wagesheet_Aug25.xlsx - Sheet1.pdf'), pf: f('PF ECR AUG-25 SAMPLE.pdf'), esic: f('ESIC ECR AUG-25 SAMPLE.pdf') };

const EXPECTED = {
  'ANIL KUMAR': ['MATCHED', 'MATCHED'], 'SUNITA DEVI': ['MATCHED', 'MATCHED'], 'RAKESH VERMA': ['MATCHED', 'MATCHED'],
  'PRIYA SINGH': ['MATCHED', 'MATCHED'], 'MANOJ YADAV': ['MATCHED', 'MATCHED'], 'KAVITA KUMARI': ['MATCHED', 'MATCHED'],
  'DINESH PRASAD': ['NAME_MISMATCH', 'MATCHED'], 'REKHA SHARMA': ['MATCHED', 'NAME_MISMATCH'], 'SANJAY PASWAN': ['MISSING', 'MISSING'],
  'POOJA GUPTA': ['MATCHED', 'MISSING'], 'VIKRAM THAKUR': ['AMOUNT_MISMATCH', 'MATCHED'], 'NEHA MISHRA': ['MATCHED', 'AMOUNT_MISMATCH'],
};

test('sample: every verdict matches the hand-worked answer', async () => {
  const r = await runVerification(FILES);
  assert.equal(r.employees.length, 12);
  for (const e of r.employees) {
    assert.deepEqual([e.pf.status, e.esic.status], EXPECTED[e.emp.name], e.emp.name);
  }
  assert.equal(r.summary.PF.shortfall, 1610);
  assert.equal(r.summary.ESIC.shortfall, 194);
  assert.equal(r.reconciliation.ok, true);
  const vikram = r.employees.find((e) => e.emp.name === 'VIKRAM THAKUR').pf;
  assert.equal(vikram.difference, -300);
});

test('sample: workbook has all sheets and the summary counts', async () => {
  const r = await runVerification(FILES);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildWorkbook(r));
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Summary', 'Verification', 'PF', 'ESIC', 'In ECR not in wagesheet', 'Data issues']);
  assert.equal(wb.getWorksheet('Verification').rowCount, 13);
});

test('wrong file in the wrong slot is refused with a clear message', async () => {
  await assert.rejects(runVerification({ ...FILES, pf: FILES.esic }), /uploaded as the PF ECR but looks like the ESIC ECR/);
});

test('document type detection', () => {
  assert.equal(detectKind("EMPLOYEE'S PROVIDENT FUND ORGANISATION ... UAN"), 'PF');
  assert.equal(detectKind("Employees' State Insurance Corporation IP Number IP Name"), 'ESIC');
  assert.equal(detectKind('Name UAN IP Number Agency ESIC @ 0.75% PF @ 12%'), 'WAGESHEET');
});
