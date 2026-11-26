// Saving each estimation as an .xlsx into a folder chosen by the user, e.g.
//   C:\Users\me\OneDrive - Company\Documents\Projekte\<Customer>\<Project>\EffortEstimation_<Customer>_<Project>.xlsx
// The base folder and the subfolder pattern are stored in <dataDir>/settings.json.
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileName } from './xlsx.js';

export const DEFAULT_PATTERN = '{customer}/{project}';

const DEFAULTS = {
  excelFolder: '', // absolute base folder; '' = do not save Excel files
  subfolderPattern: DEFAULT_PATTERN,
  excelFolderAsked: false, // the first-save dialog was answered
};

export function createSettings(dataDir) {
  const file = path.join(dataDir, 'settings.json');
  return {
    async get() {
      try {
        return { ...DEFAULTS, ...JSON.parse(await readFile(file, 'utf8')) };
      } catch (err) {
        if (err.code === 'ENOENT') return { ...DEFAULTS };
        throw err;
      }
    },
    async update(patch) {
      const next = { ...(await this.get()), ...validateSettings(patch) };
      await mkdir(dataDir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
      await rename(tmp, file);
      return next;
    },
  };
}

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

function validateSettings(patch = {}) {
  const out = {};
  if ('excelFolder' in patch) {
    const folder = String(patch.excelFolder ?? '').trim().replace(/^"(.*)"$/, '$1'); // pasted "C:\..." quotes
    if (folder && !path.isAbsolute(folder)) throw badRequest('Please enter a full folder path, e.g. C:\\Users\\you\\Documents\\Projekte');
    out.excelFolder = folder ? path.normalize(folder) : '';
  }
  if ('subfolderPattern' in patch) {
    const pattern = String(patch.subfolderPattern ?? '').trim();
    if (pattern.split(/[\\/]/).some((seg) => seg.trim() === '..')) throw badRequest('Subfolders must not contain ".."');
    if (path.isAbsolute(pattern) || /^[a-zA-Z]:/.test(pattern)) throw badRequest('Subfolders must be relative to the folder');
    out.subfolderPattern = pattern;
  }
  if ('excelFolderAsked' in patch) out.excelFolderAsked = Boolean(patch.excelFolderAsked);
  return out;
}

/** Suggested base folder: OneDrive (business first) → Documents → Projekte. */
export function suggestedFolder(env = process.env) {
  const root = env.OneDriveCommercial || env.OneDrive || env.USERPROFILE || os.homedir();
  return path.join(root, 'Documents', 'Projekte');
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** Makes a single folder/file name valid on Windows (and everywhere else). */
export function safeName(name) {
  let s = String(name ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, ''); // Windows drops trailing dots/spaces
  if (!s || s === '.' || s === '..') s = '_';
  if (RESERVED.test(s)) s = `${s}_`;
  return s.slice(0, 120);
}

/** Absolute path of the Excel file for an estimation, or null if saving is off. */
export function excelPathFor(settings, est) {
  if (!settings.excelFolder) return null;
  const base = path.resolve(settings.excelFolder);
  const values = { customer: est.customer || 'CUSTOMER', project: est.project || 'PROJECT' };
  const segments = (settings.subfolderPattern || '')
    .split(/[\\/]+/)
    .map((seg) => seg.replace(/\{(customer|project)\}/gi, (_, key) => values[key.toLowerCase()]))
    .filter((seg) => seg.trim())
    .map(safeName);
  const target = path.join(base, ...segments, fileName(est));
  const rel = path.relative(base, target);
  // Outside the base folder only if the first segment is exactly '..' (names like '.._x' are fine).
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw badRequest('Invalid subfolder pattern');
  return target;
}

/** Writes the file; a file locked by Excel becomes a friendly error. */
export async function writeExcelFile(target, buffer) {
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, buffer);
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    if (['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) {
      throw Object.assign(
        new Error(`The file is open in another program (probably Excel) or not writable: ${target}. Close it and save again.`),
        { code: 'FILE_LOCKED' },
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Desktop helpers (only used when the browser runs on the same PC as the server)
// ---------------------------------------------------------------------------
const IS_WINDOWS = process.platform === 'win32';

/** Shows the file in Explorer (selected), or opens its folder. */
export function revealInFileManager(target) {
  const child = IS_WINDOWS
    ? spawn('explorer.exe', [`/select,"${target}"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }) // Windows paths cannot contain quotes
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [path.dirname(target)], { detached: true, stdio: 'ignore' });
  child.on('error', (err) => console.error('Could not open folder:', err.message));
  child.unref();
}

/** Windows folder picker. Resolves with the chosen path, or '' when cancelled. */
export function pickFolder(initial) {
  if (!IS_WINDOWS) return Promise.reject(badRequest('The folder picker is only available on Windows.'));
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$d.Description = 'Folder for the effort estimation Excel files'",
    '$d.ShowNewFolderButton = $true',
    '$start = [Environment]::GetEnvironmentVariable("EE_PICK_START")',
    'if ($start -and (Test-Path -LiteralPath $start)) { $d.SelectedPath = $start }',
    "if ($d.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }",
  ].join('; ');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], {
      env: { ...process.env, EE_PICK_START: initial ?? '' }, // passed via env: no quoting issues
      windowsHide: true,
    });
    let out = '';
    let errText = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { errText += d; });
    child.on('error', reject);
    const timer = setTimeout(() => child.kill(), 10 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`Folder picker failed${errText ? `: ${errText.trim().split('\n')[0]}` : ''}`));
    });
  });
}
