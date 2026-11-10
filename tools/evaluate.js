#!/usr/bin/env node
// Scores the verifier against the provided sample (hand-worked expected verdicts) and a synthetic set (answer key).
//   npm run eval -- [--synthetic test-data/synthetic]
// Writes outputs/eval.md and the reports it produced.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVerification } from '../server/src/run.js';
import { buildWorkbook } from '../server/src/report/workbook.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
// every test-data/synthetic* folder (or just the one given with --synthetic)
const SYN_DIRS = args.includes('--synthetic')
  ? [path.resolve(args[args.indexOf('--synthetic') + 1])]
  : fs.readdirSync(path.join(ROOT, 'test-data')).filter((d) => d.startsWith('synthetic')).sort().map((d) => path.join(ROOT, 'test-data', d));
const file = (p) => ({ name: path.basename(p), buffer: fs.readFileSync(p) });
const lines = ['# Evaluation report', '', `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, ''];

// ---------- 1. provided sample ----------
const SAMPLE_EXPECTED = {
  'ANIL KUMAR': ['MATCHED', 'MATCHED'], 'SUNITA DEVI': ['MATCHED', 'MATCHED'], 'RAKESH VERMA': ['MATCHED', 'MATCHED'],
  'PRIYA SINGH': ['MATCHED', 'MATCHED'], 'MANOJ YADAV': ['MATCHED', 'MATCHED'], 'KAVITA KUMARI': ['MATCHED', 'MATCHED'],
  'DINESH PRASAD': ['NAME_MISMATCH', 'MATCHED'], 'REKHA SHARMA': ['MATCHED', 'NAME_MISMATCH'], 'SANJAY PASWAN': ['MISSING', 'MISSING'],
  'POOJA GUPTA': ['MATCHED', 'MISSING'], 'VIKRAM THAKUR': ['AMOUNT_MISMATCH', 'MATCHED'], 'NEHA MISHRA': ['MATCHED', 'AMOUNT_MISMATCH'],
};
const td = path.join(ROOT, 'test-data');
const sample = await runVerification({
  wagesheet: file(path.join(td, 'Sample_Wagesheet_Aug25.xlsx - Sheet1.pdf')),
  pf: file(path.join(td, 'PF ECR AUG-25 SAMPLE.pdf')),
  esic: file(path.join(td, 'ESIC ECR AUG-25 SAMPLE.pdf')),
});
let sOk = 0, sTot = 0;
const sWrong = [];
for (const e of sample.employees) {
  const exp = SAMPLE_EXPECTED[e.emp.name];
  for (const [k, i] of [['pf', 0], ['esic', 1]]) {
    sTot++;
    if (exp && e[k].status === exp[i]) sOk++;
    else sWrong.push(`${e.emp.name} ${k.toUpperCase()}: expected ${exp?.[i]}, got ${e[k].status}`);
  }
}
lines.push('## 1. Provided sample (hand-worked expected verdicts)', '');
lines.push(`- Verdicts correct: **${sOk}/${sTot}**`);
lines.push(`- Reconciliation: ${sample.reconciliation.checks.map((c) => `${c.check} ${c.ok === null ? 'n/a' : c.ok ? '✔' : '✖'}`).join(' · ')}`);
lines.push(`- PF: ${fmtCounts(sample.summary.PF.counts)} · short ₹${sample.summary.PF.shortfall}`);
lines.push(`- ESIC: ${fmtCounts(sample.summary.ESIC.counts)} · short ₹${sample.summary.ESIC.shortfall}`);
if (sWrong.length) lines.push('', 'Wrong:', ...sWrong.map((w) => `- ${w}`));
lines.push('');
fs.writeFileSync(path.join(ROOT, 'outputs', 'sample_report.xlsx'), Buffer.from(await buildWorkbook(sample)));

// ---------- 2. synthetic scale sets ----------
if (!SYN_DIRS.length) lines.push('## 2. Synthetic set', '', 'Not generated. Run `npm run generate` first.');
let setNo = 0;
for (const SYN of SYN_DIRS) {
  if (!fs.existsSync(path.join(SYN, 'answer_key.json'))) continue;
  setNo++;
  const key = JSON.parse(fs.readFileSync(path.join(SYN, 'answer_key.json'), 'utf8'));
  const t0 = Date.now();
  const res = await runVerification({ wagesheet: file(path.join(SYN, 'wagesheet.xlsx')), pf: file(path.join(SYN, 'pf_ecr.pdf')), esic: file(path.join(SYN, 'esic_ecr.pdf')) });
  const ms = Date.now() - t0;
  const byIp = new Map(res.employees.map((e) => [e.emp.ip, e]));
  const conf = {};
  const errors = [];
  let ok = 0, tot = 0, missedMismatch = 0, falseAlarm = 0, nameCases = 0;
  const perScenario = {};
  for (const k of key.employees) {
    const e = byIp.get(k.ip);
    for (const [kind, exp] of [['pf', k.expectedPF], ['esic', k.expectedESIC]]) {
      tot++;
      const got = e ? e[kind].status : 'NOT_PARSED';
      conf[`${exp} → ${got}`] = (conf[`${exp} → ${got}`] || 0) + 1;
      perScenario[k.scenario] ||= { ok: 0, n: 0 };
      perScenario[k.scenario].n++;
      if (got === exp) { ok++; perScenario[k.scenario].ok++; continue; }
      if (exp === 'NAME_MISMATCH') missedMismatch++;
      if (got === 'NAME_MISMATCH' && exp !== 'NAME_MISMATCH') falseAlarm++;
      if (errors.length < 40) errors.push(`${k.name} (${k.scenario}${k.variant ? '/' + k.variant : ''}) ${kind.toUpperCase()}: expected ${exp}, got ${got}${e ? ` — ${e[kind].reason}` : ''}`);
    }
    if (k.scenario.startsWith('name_') || k.scenario === 'long_name') nameCases++;
  }
  // ECR-only rows = generated extras in both ECRs + blank-UAN employees (their PF row can't be tied to the wagesheet)
  const expectedExtras = key.extras * 2 + key.employees.filter((k) => k.scenario === 'blank_uan').length;
  lines.push(`## 2.${setNo} Synthetic scale set \`${path.basename(SYN)}\` (${key.n} employees, answer key)`, '');
  lines.push(`- Documents: PF ECR ${res.meta.counts.pfPages} pages / ${res.meta.counts.pf} members · ESIC ECR ${res.meta.counts.esicPages} pages / ${res.meta.counts.esic} IPs · wagesheet ${res.meta.counts.wagesheet} rows (.xlsx, numeric IDs, title rows)`);
  lines.push(`- Run time: **${ms} ms**`);
  lines.push(`- Verdicts correct: **${ok}/${tot} (${((100 * ok) / tot).toFixed(2)}%)**`);
  lines.push(`- Missed genuine name mismatches: **${missedMismatch}** · False name alarms ("crying wolf"): **${falseAlarm}**`);
  lines.push(`- ECR-only rows found: ${res.extras.length} (expected ${expectedExtras})`);
  lines.push(`- Reconciliation: ${res.reconciliation.ok ? 'all checks passed' : `${res.reconciliation.failed} failed`} (${res.reconciliation.checks.map((c) => `${c.printed ?? '—'}/${c.parsed}`).join(', ')})`);
  lines.push('', '| Scenario | Correct |', '|---|---|');
  for (const [s, v] of Object.entries(perScenario)) lines.push(`| ${s} | ${v.ok}/${v.n} |`);
  lines.push('', '| Expected → Got | Count |', '|---|---|');
  for (const [k, v] of Object.entries(conf).sort((a, b) => b[1] - a[1])) lines.push(`| ${k} | ${v} |`);
  if (errors.length) lines.push('', 'First errors:', ...errors.map((x) => `- ${x}`));
  lines.push('');
  fs.writeFileSync(path.join(ROOT, 'outputs', `${path.basename(SYN)}_report.xlsx`), Buffer.from(await buildWorkbook(res)));
}

lines.push('', '## Notes', '', '- The synthetic set imitates the sample layouts and injects variations I chose (listed per scenario). It proves scale and robustness, not coverage of every real-world variation.');
fs.writeFileSync(path.join(ROOT, 'outputs', 'eval.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));

function fmtCounts(c) {
  return Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ');
}
