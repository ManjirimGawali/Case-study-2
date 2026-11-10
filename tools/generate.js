#!/usr/bin/env node
// Synthetic scale test: builds a large wagesheet (.xlsx) + multi-page PF and ESIC ECR PDFs that imitate the
// sample layouts, with injected real-world problems and an answer key (expected verdict per employee).
//
//   npm run generate -- [--n 1500] [--seed 7] [--out test-data/synthetic]
//
// Layout stress built in: PF repeats its two-line header on every page; ESIC prints the header only on page 1
// (continuation pages); some long names wrap onto a second line; the wagesheet has title rows above the
// header and stores UAN / IP numbers as Excel NUMBERS.
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const N = Number(opt('--n', 1500));
const OUT = path.resolve(opt('--out', 'test-data/synthetic'));
let seed = Number(opt('--seed', 7));
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const FIRST = ['ANIL', 'SUNITA', 'RAKESH', 'PRIYA', 'MANOJ', 'KAVITA', 'DINESH', 'REKHA', 'SANJAY', 'POOJA', 'VIKRAM', 'NEHA', 'RAJESH',
  'AMIT', 'SURESH', 'RAMESH', 'DEEPAK', 'ANJALI', 'MAHESH', 'GEETA', 'ARUN', 'SEEMA', 'VINOD', 'MAMTA', 'ASHOK', 'RENU', 'SANTOSH',
  'LALITA', 'PANKAJ', 'NISHA', 'RAVI', 'SHABNAM', 'IRFAN', 'SALIM', 'FARHAN', 'JYOTI', 'KAMLESH', 'PRADEEP', 'ANITA', 'HEMANT', 'KIRAN',
  'BABITA', 'GOPAL', 'USHA', 'NARESH', 'SAVITA', 'MUKESH', 'SUMAN', 'DHARMENDRA', 'SHILPA'];
const LAST = ['KUMAR', 'DEVI', 'SINGH', 'SHARMA', 'YADAV', 'GUPTA', 'VERMA', 'MISHRA', 'PRASAD', 'THAKUR', 'PASWAN', 'KHAN', 'ANSARI',
  'MAHTO', 'MANDAL', 'JHA', 'PANDEY', 'TIWARI', 'KUMARI', 'CHAUHAN', 'SAHU', 'RAI', 'BEGUM', 'KHATUN', 'NAYAK'];
const LONG = ['VENKATA SATYANARAYANA MURTHY', 'SRIRAMULU VENKATESWARA RAO', 'MOHAMMAD ABDUL RAHMAN QURESHI'];

// variants that must still MATCH (applied to the ECR name)
const VARIANTS = {
  order: (n) => n.split(' ').reverse().join(' '),
  honorific: (n) => `SMT. ${n}`,
  spelling: (n) => n.replace('OO', 'U').replace(/EE/, 'I').replace(/^KAVITA/, 'KAVITHA').replace(/^SHABNAM/, 'SABNAM').replace(/^DEEPAK/, 'DIPAK').replace(/^PRADEEP/, 'PRADIP'),
  middle: (n) => { const t = n.split(' '); return t.length >= 2 ? `${t[0]} KUMAR ${t.slice(1).join(' ')}` : n; },
  lowercase: (n) => n.toLowerCase().replace(/ /g, '  '),
  abbreviation: (n) => n.replace(/^MOHAMMAD/, 'MOHD'),
};
// genuine mismatches (same surname, different given name) that must be FLAGGED
const CONFUSABLE = { RAJESH: 'RAKESH', RAKESH: 'RAJESH', ANIL: 'SUNIL', SUNITA: 'SUNITI', REKHA: 'RENU', RENU: 'REKHA', DINESH: 'DEVENDRA',
  AMIT: 'SUMIT', PRIYA: 'PRIYANKA', NEHA: 'SNEHA', SURESH: 'RAMESH', RAMESH: 'SURESH', MAHESH: 'MUKESH', MUKESH: 'MAHESH', SEEMA: 'REEMA',
  ANITA: 'AMITA', ARUN: 'TARUN', GEETA: 'SEETA', KIRAN: 'KIRTI', NARESH: 'NAGESH' };

const SCENARIOS = [
  // [label, weight, expected PF, expected ESIC]
  ['clean', 52, 'MATCHED', 'MATCHED'],
  ['name_variant', 14, 'MATCHED', 'MATCHED'],
  ['name_mismatch_pf', 4, 'NAME_MISMATCH', 'MATCHED'],
  ['name_mismatch_esic', 4, 'MATCHED', 'NAME_MISMATCH'],
  ['amount_short_pf', 4, 'AMOUNT_MISMATCH', 'MATCHED'],
  ['amount_short_esic', 4, 'MATCHED', 'AMOUNT_MISMATCH'],
  ['rounding_1', 4, 'MATCHED', 'MATCHED'],
  ['missing_pf', 3, 'MISSING', 'MATCHED'],
  ['missing_esic', 3, 'MATCHED', 'MISSING'],
  ['missing_both', 2, 'MISSING', 'MISSING'],
  ['blank_uan', 1, 'MISSING', 'MATCHED'],
  ['esic_not_applicable', 2, 'MATCHED', 'NOT_APPLICABLE'],
  ['long_name', 3, 'MATCHED', 'MATCHED'],
];
const TOTAL_W = SCENARIOS.reduce((s, x) => s + x[1], 0);
const scenario = () => { let r = rnd() * TOTAL_W; for (const s of SCENARIOS) { if ((r -= s[1]) < 0) return s; } return SCENARIOS[0]; };

// ---------- build people ----------
const emps = [];
const usedNames = new Set();
for (let i = 0; i < N; i++) {
  const [label, , expPf, expEsic] = scenario();
  let name;
  do { name = label === 'long_name' ? pick(LONG) + (i % 7 ? '' : ' ' + pick(LAST)) : `${pick(FIRST)} ${pick(LAST)}`; } while (label !== 'long_name' && usedNames.has(name) && usedNames.size < 1000);
  usedNames.add(name);
  const wages = int(8000, 20500);
  const epfWages = Math.min(wages, 15000);
  const e = {
    i, label, expPf, expEsic, name,
    uan: String(100000000000 + 3000000 + i * 7 + 1),
    ip: String(1000000000 + 500000 + i * 3 + 1),
    wages, epfWages,
    pf: Math.round(epfWages * 0.12),
    esic: Math.ceil(wages * 0.0075),
  };
  e.pfEcrName = name; e.uanName = name; e.esicName = name;
  e.pfDeposit = e.pf; e.esicDeposit = e.esic;
  e.inPf = true; e.inEsic = true;
  switch (label) {
    case 'name_variant': {
      const kind = pick(Object.keys(VARIANTS));
      const v = VARIANTS[kind](name);
      e.variant = kind; e.pfEcrName = v; e.esicName = v; e.uanName = v;
      break;
    }
    case 'name_mismatch_pf': case 'name_mismatch_esic': {
      let [f, ...rest] = name.split(' ');
      if (!CONFUSABLE[f]) {
        f = pick(Object.keys(CONFUSABLE));
        e.name = `${f} ${rest.join(' ')}`;
        e.pfEcrName = e.name; e.uanName = e.name; e.esicName = e.name; // the other authority must still match
      }
      const other = `${CONFUSABLE[f]} ${rest.join(' ')}`;
      if (label === 'name_mismatch_pf') { e.pfEcrName = other; e.uanName = other; } else e.esicName = other;
      break;
    }
    case 'amount_short_pf': e.pfDeposit = e.pf - int(20, 600); break;
    case 'amount_short_esic': e.esicDeposit = e.esic - int(5, 60); break;
    case 'rounding_1': e.pfDeposit = e.pf + (rnd() < 0.5 ? 1 : -1); e.esicDeposit = e.esic + (rnd() < 0.5 ? 1 : 0); break;
    case 'missing_pf': e.inPf = false; break;
    case 'missing_esic': e.inEsic = false; break;
    case 'missing_both': e.inPf = false; e.inEsic = false; break;
    case 'blank_uan': e.wsUan = ''; break;
    case 'esic_not_applicable': e.inEsic = false; e.esic = 0; e.wages = 22000; break;
    default: break;
  }
  emps.push(e);
}
// people deposited for but absent from the wagesheet
const extras = Array.from({ length: Math.max(2, Math.round(N * 0.01)) }, (_, k) => ({
  name: `${pick(FIRST)} ${pick(LAST)}`, uan: String(100000000000 + 9000000 + k), ip: String(1000000000 + 900000 + k),
  wages: 12000, epfWages: 12000, pf: 1440, esic: 90,
}));

fs.mkdirSync(OUT, { recursive: true });

// ---------- wagesheet.xlsx ----------
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Aug-25');
ws.addRow(['SAMPLE STAFFING PVT. LTD. — Wage sheet for August 2025']);
ws.addRow(['Prepared by vendor payroll']);
ws.addRow([]);
ws.addRow(['Name', 'UAN', 'IP Number', 'Agency', 'State', 'ESIC @ 0.75%', 'PF @ 12%']);
for (const e of emps) {
  ws.addRow([e.name, e.wsUan === '' ? '' : Number(e.uan), Number(e.ip), 'Sample Staffing Pvt. Ltd.', pick(['Bihar', 'Haryana', 'Karnataka', 'Maharashtra']), e.esic, e.pf]);
}
ws.addRow([]);
ws.addRow(['Total', '', '', '', '', emps.reduce((s, e) => s + e.esic, 0), emps.reduce((s, e) => s + e.pf, 0)]);
await wb.xlsx.writeFile(path.join(OUT, 'wagesheet.xlsx'));

// ---------- PF ECR ----------
const pfRows = [...emps.filter((e) => e.inPf), ...extras.map((x) => ({ ...x, pfEcrName: x.name, uanName: x.name, pfDeposit: x.pf }))]
  .sort((a, b) => a.uan.localeCompare(b.uan));
await pdf(path.join(OUT, 'pf_ecr.pdf'), (doc) => {
  const fmt = (v) => Number(v).toLocaleString('en-IN');
  const eps = (r) => Math.round(r.epfWages * 0.0833);
  const tot = pfRows.reduce((s, r) => ({ ee: s.ee + r.pfDeposit, eps: s.eps + eps(r), er: s.er + (r.pfDeposit - eps(r)) }), { ee: 0, eps: 0, er: 0 });
  doc.font('Helvetica-Bold').fontSize(12).text("EMPLOYEE'S PROVIDENT FUND ORGANISATION", 0, 40, { align: 'center' });
  doc.font('Helvetica').fontSize(10).text('ELECTRONIC CHALLAN CUM RETURN (ECR)', { align: 'center' });
  const kv = [['Name of Establishment', 'SAMPLE STAFFING PRIVATE LIMITED'], ['Wage Month', 'AUG-2025'], ['Total Members', String(pfRows.length)]];
  kv.forEach(([k, v], i) => { doc.fontSize(8).text(k, 46, 80 + i * 18); doc.text(v, 182, 80 + i * 18); });
  doc.text('Total EPF Contribution', 49, 150); doc.text(fmt(tot.ee), 196, 150);
  doc.text('Total EPS Contribution', 304, 150); doc.text(fmt(tot.eps), 451, 150);
  doc.text('Total EPF-EPS Contribution', 49, 168); doc.text(fmt(tot.er), 196, 168);
  const cols = [['Sl. No.', 24, 28], ['UAN', 56, 60], ['Name as per ECR', 124, 80], ['Name as per\nUAN Repository', 209, 80], ['Gross\nWages', 294, 34],
    ['EPF\nWages', 333, 34], ['EPS\nWages', 373, 34], ['EDLI\nWages', 413, 34], ['EE', 452, 26], ['EPS', 486, 26], ['ER', 520, 26], ['NCP\nDays', 555, 20]];
  const head = (y) => { doc.font('Helvetica-Bold').fontSize(6.5); for (const [t, x, w] of cols) doc.text(t, x, y, { width: w + 10, lineGap: 1 }); doc.font('Helvetica').fontSize(6.5); return y + 24; };
  let y = head(200);
  pfRows.forEach((r, i) => {
    const h = Math.max(doc.heightOfString(r.pfEcrName, { width: 80 }), doc.heightOfString(r.uanName, { width: 80 }));
    if (y + h > 780) { doc.addPage(); y = head(40); }
    const nums = [r.wages, r.epfWages, r.epfWages, r.epfWages, r.pfDeposit, eps(r), r.pfDeposit - eps(r), int(0, 4)];
    doc.text(String(i + 1), 24, y); doc.text(r.uan, 56, y); doc.text(r.pfEcrName, 124, y, { width: 80 }); doc.text(r.uanName, 209, y, { width: 80 });
    [294, 333, 373, 413, 452, 486, 520, 555].forEach((x, k) => doc.text(fmt(nums[k]), x, y, { width: 30, align: 'right' }));
    y += Math.max(h, 9) + 7;
  });
});

// ---------- ESIC ECR ----------
const esicRows = [...emps.filter((e) => e.inEsic), ...extras.map((x) => ({ ...x, esicName: x.name, esicDeposit: x.esic }))]
  .sort((a, b) => a.ip.localeCompare(b.ip));
await pdf(path.join(OUT, 'esic_ecr.pdf'), (doc) => {
  const totIp = esicRows.reduce((s, r) => s + r.esicDeposit, 0);
  const totW = esicRows.reduce((s, r) => s + r.wages, 0);
  doc.font('Helvetica').fontSize(12).text("Employees' State Insurance Corporation", 0, 40, { align: 'center' });
  doc.fontSize(9).text('Contribution History Of 99000000000000999 for Aug2025', { align: 'center' });
  doc.font('Helvetica-Bold').fontSize(7).text('Total IP Contribution', 49, 90); doc.text('Total Monthly Wages', 465, 90);
  doc.font('Helvetica').text(totIp.toFixed(2), 49, 106); doc.text(totW.toFixed(2), 465, 106);
  const H = [['SNo.', 29], ['Is Disable', 63], ['IP Number', 114], ['IP Name', 187], ['No. Of Days', 335], ['Total Wages', 392], ['IP Contribution', 460], ['Reason', 533]];
  doc.font('Helvetica-Bold').fontSize(7.5); for (const [t, x] of H) doc.text(t, x, 130); doc.font('Helvetica');
  let y = 150, page = 1;
  const pages = Math.ceil(esicRows.length / 32);
  esicRows.forEach((r, i) => {
    if (y > 770) { doc.fontSize(7).text(`Page ${page} of ${pages}`, 75, 800); doc.addPage(); page++; y = 50; } // no header on continuation pages
    doc.fontSize(7.5).text(String(i + 1), 29, y); doc.text('-', 63, y); doc.text(r.ip, 114, y); doc.text(r.esicName, 187, y, { width: 140 });
    doc.text(String(int(20, 31)), 335, y); doc.text(r.wages.toFixed(2), 392, y); doc.text(r.esicDeposit.toFixed(2), 460, y); doc.text('-', 533, y);
    y += Math.max(doc.heightOfString(r.esicName, { width: 140 }), 9) + 10;
  });
  doc.fontSize(7).text(`Page ${page} of ${pages}`, 75, 800);
});

// ---------- answer key ----------
const key = emps.map((e) => ({ name: e.name, uan: e.wsUan === '' ? '' : e.uan, ip: e.ip, scenario: e.label, variant: e.variant || '', expectedPF: e.expPf, expectedESIC: e.expEsic }));
fs.writeFileSync(path.join(OUT, 'answer_key.json'), JSON.stringify({ n: N, extras: extras.length, employees: key }, null, 1));
const counts = key.reduce((m, k) => ((m[k.scenario] = (m[k.scenario] || 0) + 1), m), {});
console.log(`Wrote ${OUT}: ${N} employees (+${extras.length} ECR-only), scenarios:`, counts);

function pdf(file, draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 20, autoFirstPage: true });
    const s = fs.createWriteStream(file);
    doc.pipe(s);
    draw(doc);
    doc.end();
    s.on('finish', resolve); s.on('error', reject);
  });
}
