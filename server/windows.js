// Entry point for the single-file Windows executable (EffortEstimation.exe).
// Bundled to CommonJS by scripts/build-windows.mjs and embedded into node.exe
// as a Node.js "single executable application" (SEA).
//
//   EffortEstimation.exe          start in the background (used for autostart)
//   EffortEstimation.exe --open   start if needed, then open the browser
//   EffortEstimation.exe --stop   stop the running instance
//
// Settings: %LOCALAPPDATA%\EffortEstimation\config.json
// Data:     %LOCALAPPDATA%\EffortEstimation\data
// Log:      %LOCALAPPDATA%\EffortEstimation\logs\server.log
import express from 'express';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { APP_ID, createApp, listen } from './app.js';

/* global __APP_VERSION__ */
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
const IS_WINDOWS = process.platform === 'win32';
const args = new Set(process.argv.slice(2).map((a) => a.toLowerCase()));

const HOME = process.env.EE_HOME
  ?? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'share'), 'EffortEstimation');
const CONFIG_FILE = path.join(HOME, 'config.json');
const LOG_FILE = path.join(HOME, 'logs', 'server.log');

const DEFAULT_CONFIG = {
  port: 3080,
  host: '0.0.0.0',
  dataDir: '',
  proofhubCompany: '',
  proofhubApiKey: '',
};

// ---------------------------------------------------------------------------
// Logging (no console window in the GUI-subsystem build)
// ---------------------------------------------------------------------------
function setupLogging() {
  mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  try {
    if (statSync(LOG_FILE).size > 5 * 1024 * 1024) renameSync(LOG_FILE, `${LOG_FILE}.old`);
  } catch { /* no log yet */ }
  const write = (level) => (...parts) => {
    const line = parts.map((p) => (p instanceof Error ? p.stack : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
    try {
      appendFileSync(LOG_FILE, `${new Date().toISOString()} ${level} ${line}\n`);
    } catch { /* ignore */ }
  };
  console.log = console.info = write('INFO ');
  console.warn = write('WARN ');
  console.error = write('ERROR');
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    process.exit(1);
  });
}

function loadConfig() {
  mkdirSync(HOME, { recursive: true });
  if (!existsSync(CONFIG_FILE)) writeFileSync(CONFIG_FILE, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(readFileSync(CONFIG_FILE, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    console.error(`Could not read ${CONFIG_FILE}, using defaults:`, err.message);
  }
  const cfg = { ...DEFAULT_CONFIG, ...fileConfig };
  // Environment variables override the file.
  const port = Number(process.env.PORT ?? cfg.port);
  return {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_CONFIG.port,
    host: process.env.HOST ?? cfg.host ?? DEFAULT_CONFIG.host,
    dataDir: path.resolve(process.env.DATA_DIR || cfg.dataDir || path.join(HOME, 'data')),
    proofhubCompany: process.env.PROOFHUB_COMPANY ?? cfg.proofhubCompany,
    proofhubApiKey: process.env.PROOFHUB_API_KEY ?? cfg.proofhubApiKey,
  };
}

// ---------------------------------------------------------------------------
// Windows helpers
// ---------------------------------------------------------------------------
function detached(cmd, cmdArgs) {
  try {
    const child = spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore', windowsHide: true });
    // Spawn failures (missing program, blocked by policy) arrive as an async
    // 'error' event; without a listener they would crash the server.
    child.on('error', (err) => console.error(`Could not run ${cmd}:`, err.message));
    child.unref();
  } catch (err) {
    console.error(`Could not run ${cmd}:`, err.message);
  }
}

function openBrowser(url) {
  console.log(`Opening ${url}`);
  if (IS_WINDOWS) detached('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
  else if (process.platform === 'darwin') detached('open', [url]);
  else detached('xdg-open', [url]);
}

function messageBox(text, icon = 'Warning') {
  console.warn(`Message: ${text}`);
  if (!IS_WINDOWS) return;
  const esc = (s) => s.replace(/'/g, "''");
  detached('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${esc(text)}', 'Effort Estimation', 'OK', '${icon}') | Out-Null`,
  ]);
}

async function request(port, pathname, method = 'GET') {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { method, signal: AbortSignal.timeout(2000) });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch {
    return null; // nothing listening / not reachable
  }
}

const isOurInstance = async (port) => (await request(port, '/api/health'))?.body?.app === APP_ID;

// ---------------------------------------------------------------------------
// Frontend: embedded SEA assets, or ./dist when run with plain node (testing)
// ---------------------------------------------------------------------------
function frontendMounter() {
  // Inside the executable only require() can load built-ins such as node:sea.
  const req = typeof require === 'function' ? require : createRequire(path.join(process.cwd(), 'noop.js'));
  let sea = null;
  try {
    sea = req('node:sea');
    if (!sea.isSea()) sea = null;
  } catch { sea = null; }

  if (!sea) {
    const dist = path.resolve(process.env.EE_DIST ?? path.join(process.cwd(), 'dist'));
    return (app) => {
      app.use(express.static(dist, { maxAge: '1h' }));
      app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    };
  }

  const cache = new Map();
  const asset = (key) => {
    if (cache.has(key)) return cache.get(key);
    let buf = null;
    try { buf = Buffer.from(sea.getAsset(key)); } catch { /* not embedded */ }
    cache.set(key, buf);
    return buf;
  };
  return (app) => {
    app.get('/{*splat}', (req, res) => {
      let key = decodeURIComponent(req.path).replace(/^\/+/, '');
      let buf = key && !key.includes('..') ? asset(key) : null;
      if (!buf) {
        if (path.extname(key)) return res.status(404).end(); // missing file
        key = 'index.html'; // SPA fallback
        buf = asset(key);
      }
      res.type(path.extname(key) || 'html');
      res.set('Cache-Control', key.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.send(buf);
    });
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  setupLogging();
  const cfg = loadConfig();
  const localUrl = `http://localhost:${cfg.port}/`;

  if (args.has('--stop')) {
    const res = await request(cfg.port, '/api/shutdown', 'POST');
    console.log(res?.status === 200 ? 'Stopped running instance.' : 'No running instance found.');
    return;
  }

  if (await isOurInstance(cfg.port)) {
    console.log('Already running.');
    if (args.has('--open')) openBrowser(localUrl);
    return;
  }

  // Make the ProofHub settings from config.json visible to server/proofhub.js.
  if (cfg.proofhubCompany) process.env.PROOFHUB_COMPANY = cfg.proofhubCompany;
  if (cfg.proofhubApiKey) process.env.PROOFHUB_API_KEY = cfg.proofhubApiKey;

  let server;
  const app = createApp({
    dataDir: cfg.dataDir,
    version: VERSION,
    mountFrontend: frontendMounter(),
    onShutdown: () => {
      console.log('Shutdown requested.');
      server?.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    },
  });

  try {
    server = await listen(app, cfg.port, cfg.host);
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      messageBox(
        `Port ${cfg.port} is already used by another program, so Effort Estimation could not start.\n\n` +
          `Choose a different "port" in:\n${CONFIG_FILE}\n\nthen start Effort Estimation again.`,
      );
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  console.log(`Effort Estimation ${VERSION} running on ${localUrl} (listening on ${cfg.host}:${cfg.port}, data: ${cfg.dataDir})`);
  if (args.has('--open')) openBrowser(localUrl);
}

main().catch((err) => {
  console.error('Fatal:', err);
  messageBox(`Effort Estimation could not start:\n${err.message}\n\nDetails: ${LOG_FILE}`, 'Error');
  process.exitCode = 1;
});
