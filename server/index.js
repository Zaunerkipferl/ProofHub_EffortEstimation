import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REQUIREMENT_TYPES, buildWorkbook, fileName, parseWorkbook } from './xlsx.js';
import { createStore } from './store.js';
import { proofhubConfig, updateEstimation, uploadEstimation } from './proofhub.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(root, 'data'));

const store = createStore(path.join(DATA_DIR, 'estimations'));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const sendXlsx = async (res, est) => {
  const buf = await buildWorkbook(est);
  const name = fileName(est);
  res
    .type(XLSX_MIME)
    .set('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`)
    .send(buf);
};

app.get('/api/config', (_req, res) => {
  res.json({ requirementTypes: REQUIREMENT_TYPES, proofhub: { configured: proofhubConfig().configured } });
});

// Stateless export: build an xlsx from the posted estimation.
app.post('/api/export', async (req, res) => sendXlsx(res, req.body));

// Import an existing xlsx (template layout) into the editor.
app.post('/api/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  try {
    res.json(await parseWorkbook(req.file.buffer));
  } catch (err) {
    res.status(422).json({ error: `Could not read the Excel file: ${err.message}` });
  }
});

// Saved estimations
app.get('/api/estimations', async (_req, res) => res.json(await store.list()));
app.post('/api/estimations', async (req, res) => res.status(201).json(await store.create(req.body)));
app.get('/api/estimations/:id', async (req, res) => {
  const est = await store.get(req.params.id);
  est ? res.json(est) : res.status(404).json({ error: 'Not found' });
});
app.put('/api/estimations/:id', async (req, res) => {
  const est = await store.update(req.params.id, req.body);
  est ? res.json(est) : res.status(404).json({ error: 'Not found' });
});
app.delete('/api/estimations/:id', async (req, res) => {
  await store.remove(req.params.id);
  res.status(204).end();
});
app.get('/api/estimations/:id/xlsx', async (req, res) => {
  const est = await store.get(req.params.id);
  est ? sendXlsx(res, est) : res.status(404).json({ error: 'Not found' });
});

// ProofHub (steps 2 + 3) — routes exist so the UI contract is fixed already.
app.post('/api/estimations/:id/proofhub', async (req, res) => {
  res.json(await uploadEstimation(req.params.id, req.body));
});
app.put('/api/estimations/:id/proofhub', async (req, res) => {
  res.json(await updateEstimation(req.params.id));
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Static frontend (built by `npm run build`)
const dist = path.join(root, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { index: 'index.html', maxAge: '1h' }));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Express 5 forwards async errors here.
app.use((err, _req, res, _next) => {
  const status = err.status ?? 500;
  if (status >= 500 && status !== 501) console.error(err);
  res.status(status).json({ error: err.message ?? 'Internal error' });
});

app.listen(PORT, HOST, () => {
  console.log(`Effort Estimation running on http://${HOST}:${PORT} (data: ${DATA_DIR})`);
});
