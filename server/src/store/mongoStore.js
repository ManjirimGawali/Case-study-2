// MongoDB store (set MONGO_URL). Same interface as fileStore. Note: one run is one document (16 MB limit ≈ 10k+ employees).
import mongoose from 'mongoose';
import { CFG } from '../config.js';

const Run = mongoose.model('Run', new mongoose.Schema({ createdAt: { type: Date, default: Date.now }, result: mongoose.Schema.Types.Mixed }, { minimize: false }));

export const mongoStore = {
  kind: 'mongodb',
  async init() { await mongoose.connect(CFG.MONGO_URL, { serverSelectionTimeoutMS: 5000 }); },
  async save(result) { const d = await Run.create({ result }); return { id: String(d._id), createdAt: d.createdAt.toISOString() }; },
  async get(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    const d = await Run.findById(id).lean();
    return d ? { id: String(d._id), createdAt: d.createdAt.toISOString(), result: d.result } : null;
  },
  async list() {
    const docs = await Run.find({}, { 'result.meta': 1, 'result.summary': 1, 'result.reconciliation.ok': 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(50).lean();
    return docs.map((d) => ({ id: String(d._id), createdAt: d.createdAt.toISOString(), files: d.result.meta.files, summary: { PF: d.result.summary.PF.counts, ESIC: d.result.summary.ESIC.counts }, reconciliationOk: d.result.reconciliation.ok }));
  },
};
