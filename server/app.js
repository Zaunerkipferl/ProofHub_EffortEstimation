// Express application (routes only). Started by server/index.js (Node / Docker)
// or server/windows.js (single-file Windows executable).
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { REQUIREMENT_TYPES, buildWorkbook, fileName, parseWorkbook } from './xlsx.js';
import { createStore } from './store.js';
import { proofhubConfig, updateEstimation, uploadEstimation } from './proofhub.js';

export const APP_ID = 'effort-estimation';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * @param {object} opts
 * @param {string} opts.dataDir           where estimations are stored
 * @param {(app: import('express').Express) => void} [opts.mountFrontend]  serves the built web UI
 * @param {() => void} [opts.onShutdown]  enables POST /api/shutdown (local requests only)
 * @param {string} [opts.version]
 */
export function createApp({ dataDir, mountFrontend, onShutdown, version = '0.0.0' }) {
  const store = createStore(path.join(dataDir, 'estimations'));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  const sendXlsx = async (res, est) => {
    const buf = await buildWorkbook(est);
    const name = fileName(est);
    res
      .type(XLSX_MIME)
      .set('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`)
      .send(buf);
  };

  // Lets a second launch detect that this app (not some other program) owns the port.
  app.get('/api/health', (_req, res) => res.json({ app: APP_ID, version }));

  if (onShutdown) {
    app.post('/api/shutdown', (req, res) => {
      if (!LOOPBACK.has(req.socket.remoteAddress)) return res.status(403).json({ error: 'Forbidden' });
      res.json({ ok: true });
      setImmediate(onShutdown);
    });
  }

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

  mountFrontend?.(app);

  // Express 5 forwards async errors here.
  app.use((err, _req, res, _next) => {
    const status = err.status ?? 500;
    if (status >= 500 && status !== 501) console.error(err);
    res.status(status).json({ error: err.message ?? 'Internal error' });
  });

  return app;
}

/** Starts listening; resolves with the server or rejects with the listen error (e.g. EADDRINUSE). */
export function listen(app, port, host) {
  return new Promise((resolve, reject) => {
    // Express 5 also invokes this callback with the error when listening fails.
    const server = app.listen(port, host, (err) => (err ? reject(err) : resolve(server)));
  });
}
