// Express API + built React UI on one port.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { CFG, ROOT } from './config.js';
import { initStore, store } from './store/index.js';
import { router } from './routes/runs.js';

const app = express();
app.get('/api/health', (req, res) => res.json({ ok: true, store: store.kind, amountTolerance: CFG.AMOUNT_TOLERANCE, aiNameOpinion: CFG.AI_NAME_OPINION }));
app.use('/api', router);

const dist = path.join(ROOT, 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ error: err.message });
});

await initStore();
app.listen(CFG.PORT, () => {
  console.log(`ECR Verifier on http://localhost:${CFG.PORT}  (store: ${store.kind})`);
  if (!fs.existsSync(dist)) console.log('  UI not built — run "npm run build", or "npm run dev" for the Vite dev server on :5174');
});
