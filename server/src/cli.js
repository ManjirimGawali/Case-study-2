#!/usr/bin/env node
// npm run verify -- --wagesheet <file> --pf <file> --esic <file> [-o outputs/report.xlsx] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { runVerification } from './run.js';
import { buildWorkbook, toCsv } from './report/workbook.js';

const args = process.argv.slice(2);
const opt = (...names) => { for (const n of names) { const i = args.indexOf(n); if (i >= 0) return args[i + 1]; } return null; };
const ws = opt('--wagesheet', '-w'), pf = opt('--pf', '-p'), esic = opt('--esic', '-e');
if (!ws || !pf || !esic) {
  console.error('Usage: npm run verify -- --wagesheet <xlsx|csv|pdf> --pf <PF ECR pdf> --esic <ESIC ECR pdf> [-o report.xlsx] [--json]');
  process.exit(1);
}
const out = path.resolve(opt('-o', '--out') || 'outputs/report.xlsx');
const file = (p) => ({ name: path.basename(p), buffer: fs.readFileSync(p) });

try {
  const result = await runVerification({ wagesheet: file(ws), pf: file(pf), esic: file(esic) });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await buildWorkbook(result)));
  fs.writeFileSync(out.replace(/\.xlsx$/, '') + '.csv', toCsv(result));
  if (args.includes('--json')) fs.writeFileSync(out.replace(/\.xlsx$/, '') + '.json', JSON.stringify(result, null, 2));

  const m = result.meta.counts;
  console.log(`Parsed: wagesheet ${m.wagesheet} employees · PF ECR ${m.pf} members (${m.pfPages} page(s)) · ESIC ECR ${m.esic} IPs (${m.esicPages} page(s)) in ${result.meta.ms} ms`);
  console.log(`Reconciliation: ${result.reconciliation.ok ? 'all checks passed' : `${result.reconciliation.failed} CHECK(S) FAILED — see Summary sheet`}`);
  console.table(Object.fromEntries(['MATCHED', 'NAME_MISMATCH', 'AMOUNT_MISMATCH', 'MISSING', 'NOT_APPLICABLE'].map((s) => [s, { PF: result.summary.PF.counts[s], ESIC: result.summary.ESIC.counts[s] }])));
  console.log(`Short-deposited: PF ₹${result.summary.PF.shortfall} · ESIC ₹${result.summary.ESIC.shortfall}`);
  console.log(`Report: ${out}`);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(2);
}
