// Default store: one JSON file per run in data/runs/ (no database needed).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from '../config.js';

const DIR = path.join(ROOT, 'data', 'runs');

export const fileStore = {
  kind: 'file (data/runs)',
  async init() { fs.mkdirSync(DIR, { recursive: true }); },
  async save(result) {
    const id = crypto.randomBytes(6).toString('hex');
    const createdAt = new Date().toISOString();
    fs.writeFileSync(path.join(DIR, `${id}.json`), JSON.stringify({ id, createdAt, result }));
    return { id, createdAt };
  },
  async get(id) {
    if (!/^[a-f0-9]{12}$/.test(id)) return null;
    const p = path.join(DIR, `${id}.json`);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  },
  async list() {
    return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => {
      const { id, createdAt, result } = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      return { id, createdAt, files: result.meta.files, summary: { PF: result.summary.PF.counts, ESIC: result.summary.ESIC.counts }, reconciliationOk: result.reconciliation.ok };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  },
};
