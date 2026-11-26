// Entry point for running with Node.js (npm start, Docker).
import express from 'express';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp, listen } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(root, 'data'));
const dist = path.join(root, 'dist');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

const app = createApp({
  dataDir: DATA_DIR,
  version,
  mountFrontend: existsSync(dist)
    ? (a) => {
        a.use(express.static(dist, { index: 'index.html', maxAge: '1h' }));
        a.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
      }
    : undefined,
});

try {
  await listen(app, PORT, HOST);
  console.log(`Effort Estimation running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (data: ${DATA_DIR})`);
} catch (err) {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(
    `Port ${PORT} is already used by another program.\n` +
      'Start the tool on a different port, e.g.\n' +
      '  PowerShell:  $env:PORT=3080; npm start\n' +
      '  cmd:         set PORT=3080 && npm start\n' +
      '  bash:        PORT=3080 npm start',
  );
  process.exit(1);
}
