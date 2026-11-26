// Express application (routes only). Started by server/index.js (Node / Docker)
// or server/windows.js (single-file Windows executable).
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { REQUIREMENT_TYPES, buildWorkbook, fileName, parseWorkbook } from './xlsx.js';
import { createStore } from './store.js';
import { createSettings, excelPathFor, pickFolder, revealInFileManager, suggestedFolder, writeExcelFile } from './excelfolder.js';
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
  const settings = createSettings(dataDir);
  const isLocal = (req) => LOOPBACK.has(req.socket.remoteAddress);
  // Desktop actions: same PC only, and JSON only (a cross-site page cannot send
  // that without a CORS preflight, which this server never allows).
  const localOnly = (req, res, next) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only available on the PC running Effort Estimation.' });
    if (!req.is('application/json')) return res.status(415).json({ error: 'Expected JSON' });
    next();
  };

  /** Saves the Excel copy if a folder is configured; never fails the save itself. */
  const saveExcelCopy = async (record) => {
    const cfg = await settings.get();
    let target;
    try {
      target = excelPathFor(cfg, record);
      if (!target) return { ...record, excelError: null };
      await writeExcelFile(target, await buildWorkbook(record));
      const updated = record.excelFile === target ? record : await store.setExcelFile(record.id, target);
      return { ...updated, excelError: null };
    } catch (err) {
      console.error('Excel copy failed:', err.message);
      return { ...record, excelError: err.code === 'FILE_LOCKED' ? err.message : `Could not write ${target ?? 'the Excel file'}: ${err.message}` };
    }
  };
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
  app.post('/api/estimations', async (req, res) => res.status(201).json(await saveExcelCopy(await store.create(req.body))));
  app.get('/api/estimations/:id', async (req, res) => {
    const est = await store.get(req.params.id);
    est ? res.json(est) : res.status(404).json({ error: 'Not found' });
  });
  app.put('/api/estimations/:id', async (req, res) => {
    const est = await store.update(req.params.id, req.body);
    est ? res.json(await saveExcelCopy(est)) : res.status(404).json({ error: 'Not found' });
  });

  // Excel folder settings
  const settingsResponse = async (req, cfg) => ({
    ...(cfg ?? (await settings.get())),
    suggestedFolder: suggestedFolder(),
    pathSeparator: path.sep,
    local: isLocal(req), // "Open folder" / "Browse…" are offered only on the server PC
    canBrowse: isLocal(req) && process.platform === 'win32',
  });
  app.get('/api/settings', async (req, res) => res.json(await settingsResponse(req)));
  app.put('/api/settings', async (req, res) => res.json(await settingsResponse(req, await settings.update(req.body))));
  app.post('/api/settings/preview', async (req, res) => {
    const cfg = { ...(await settings.get()), ...req.body.settings };
    res.json({ path: excelPathFor(cfg, req.body.estimation ?? {}) });
  });
  app.post('/api/desktop/pick-folder', localOnly, async (req, res) => {
    res.json({ folder: await pickFolder(req.body.initial) });
  });
  app.post('/api/desktop/reveal', localOnly, async (req, res) => {
    const est = await store.get(String(req.body.id ?? ''));
    if (!est?.excelFile) return res.status(404).json({ error: 'No Excel file saved for this estimation yet.' });
    revealInFileManager(est.excelFile); // only paths the app wrote itself
    res.json({ ok: true });
  });
  app.delete('/api/estimations/:id', async (req, res) => {
    (await store.remove(req.params.id)) ? res.status(204).end() : res.status(404).json({ error: 'Not found' });
  });
  app.post('/api/estimations/:id/restore', async (req, res) => {
    const est = await store.restore(req.params.id);
    est ? res.json(est) : res.status(404).json({ error: 'Not found in trash' });
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
