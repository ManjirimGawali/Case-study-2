import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { runVerification } from '../run.js';
import { buildWorkbook, toCsv } from '../report/workbook.js';
import { store } from '../store/index.js';
import { CFG, ROOT } from '../config.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: CFG.MAX_FILE_MB * 1024 * 1024 } });
const fields = upload.fields([{ name: 'wagesheet', maxCount: 1 }, { name: 'pf', maxCount: 1 }, { name: 'esic', maxCount: 1 }]);
export const router = express.Router();

async function runAndSave(files, res) {
  try {
    const result = await runVerification(files);
    const saved = await store.save(result);
    res.status(201).json({ ...saved, result: slim(result) });
  } catch (e) {
    res.status(422).json({ error: e.message });
  }
}

router.post('/runs', fields, async (req, res) => {
  const get = (k) => req.files?.[k]?.[0];
  const missing = ['wagesheet', 'pf', 'esic'].filter((k) => !get(k));
  if (missing.length) return res.status(400).json({ error: `Missing file(s): ${missing.join(', ')}` });
  const f = (k) => ({ name: get(k).originalname, buffer: get(k).buffer });
  await runAndSave({ wagesheet: f('wagesheet'), pf: f('pf'), esic: f('esic') }, res);
});

// Demo: run on the bundled sample files
router.post('/runs/sample', async (req, res) => {
  const td = path.join(ROOT, 'test-data');
  const f = (n) => ({ name: n, buffer: fs.readFileSync(path.join(td, n)) });
  await runAndSave({ wagesheet: f('Sample_Wagesheet_Aug25.xlsx - Sheet1.pdf'), pf: f('PF ECR AUG-25 SAMPLE.pdf'), esic: f('ESIC ECR AUG-25 SAMPLE.pdf') }, res);
});

router.get('/runs', async (req, res, next) => { try { res.json(await store.list()); } catch (e) { next(e); } });

router.get('/runs/:id', async (req, res, next) => {
  try {
    const run = await store.get(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json({ id: run.id, createdAt: run.createdAt, result: slim(run.result) });
  } catch (e) { next(e); }
});

router.get('/runs/:id/report.xlsx', async (req, res, next) => {
  try {
    const run = await store.get(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ecr_verification_${run.id}.xlsx"`);
    res.send(Buffer.from(await buildWorkbook(run.result)));
  } catch (e) { next(e); }
});

router.get('/runs/:id/report.csv', async (req, res, next) => {
  try {
    const run = await store.get(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ecr_verification_${run.id}.csv"`);
    res.send(toCsv(run.result));
  } catch (e) { next(e); }
});

/** Only what the UI needs per employee (keeps responses small for big batches). */
function slim(r) {
  const pick = (v) => ({ status: v.status, reason: v.reason, ecrName: v.ecrName, nameMatch: v.nameMatch, deducted: v.deducted, deposited: v.deposited, difference: v.difference, notes: v.notes });
  return { ...r, employees: r.employees.map((e) => ({ emp: e.emp, pf: pick(e.pf), esic: pick(e.esic) })) };
}
