// Builds the Windows single-file executable and its installer.
//
//   npm run build:windows
//
// Output (build/windows/):
//   EffortEstimation.exe                     portable app (node.exe + app + web UI)
//   EffortEstimation-Setup-<version>.exe     installer (Start menu, autostart, uninstall)
//
// Works on Linux (cross-build) and on Windows. Needs:
//   - the same Node.js version that is embedded (the SEA blob is version-specific)
//   - NSIS (makensis) for the installer — Linux: `apt install nsis`, Windows: nsis.sourceforge.io
import { build } from 'esbuild';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postject from 'postject';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'build', 'windows');
const cache = path.join(root, 'build', 'cache');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const NODE_VERSION = process.versions.node; // must match the embedded node.exe
const KEEP = process.argv.includes('--keep'); // keep app.cjs / sea-prep.blob (testing)
const REQUIRE_INSTALLER = process.argv.includes('--require-installer') || Boolean(process.env.CI);

const step = (msg) => console.log(`\n▸ ${msg}`);
const IS_WIN = process.platform === 'win32';
// npm/npx are .cmd files on Windows and need a shell; absolute paths must not use one.
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root, shell: IS_WIN && !path.isAbsolute(cmd), ...opts });
const has = (cmd) =>
  path.isAbsolute(cmd) ? existsSync(cmd) : spawnSync(IS_WIN ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(cache, { recursive: true });

// 1. Frontend ---------------------------------------------------------------
step('Building web UI (vite)');
run('npx', ['vite', 'build']);

// 2. Server bundle (CommonJS, all dependencies inlined) ---------------------
step('Bundling server (esbuild)');
const bundle = path.join(out, 'app.cjs');
await build({
  entryPoints: [path.join(root, 'server', 'windows.js')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: `node${NODE_VERSION.split('.')[0]}`,
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  logLevel: 'warning',
});

// 3. SEA blob with the web UI as embedded assets ----------------------------
step('Creating single-executable blob');
const dist = path.join(root, 'dist');
const assets = {};
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else assets[path.relative(dist, full).split(path.sep).join('/')] = full;
  }
})(dist);
const blob = path.join(out, 'sea-prep.blob');
const seaConfig = path.join(out, 'sea-config.json');
writeFileSync(seaConfig, JSON.stringify({
  main: bundle,
  output: blob,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false, // code cache is platform specific; we may be cross-building
  assets,
}, null, 2));
run(process.execPath, ['--experimental-sea-config', seaConfig]);
console.log(`  ${Object.keys(assets).length} web assets embedded`);

// 4. node.exe for Windows (same version as this Node) -----------------------
step(`Fetching node.exe ${NODE_VERSION} (win-x64)`);
const nodeExe = path.join(cache, `node-${NODE_VERSION}-win-x64.exe`);
if (!existsSync(nodeExe)) {
  const tgzName = `node-win-x64-${NODE_VERSION}.tgz`;
  run('npm', ['pack', `node-win-x64@${NODE_VERSION}`, '--silent', '--pack-destination', cache]);
  const extract = path.join(cache, `node-win-x64-${NODE_VERSION}`);
  mkdirSync(extract, { recursive: true });
  run('tar', ['-xzf', path.join(cache, tgzName), '-C', extract]);
  copyFileSync(path.join(extract, 'package', 'bin', 'node.exe'), nodeExe);
  rmSync(extract, { recursive: true, force: true });
  rmSync(path.join(cache, tgzName), { force: true });
}

// 5. Executable ---------------------------------------------------------------
step('Creating EffortEstimation.exe');
const exe = path.join(out, 'EffortEstimation.exe');
// Injecting invalidates node.exe's Authenticode signature, so remove it
// (an invalid signature looks worse to Windows than none).
writeFileSync(exe, stripAuthenticodeSignature(readFileSync(nodeExe)));
await postject.inject(exe, 'NODE_SEA_BLOB', readFileSync(blob), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
});
setWindowsGuiSubsystem(exe);
console.log(`  ${(statSync(exe).size / 1024 / 1024).toFixed(1)} MB, no console window`);

// 6. Installer ----------------------------------------------------------------
step('Building installer (NSIS)');
const makensis = ['makensis', 'C:\\Program Files (x86)\\NSIS\\makensis.exe', 'C:\\Program Files\\NSIS\\makensis.exe'].find(has);
if (!makensis) {
  const msg = 'makensis not found — install NSIS to build the installer.';
  if (REQUIRE_INSTALLER) throw new Error(msg);
  console.warn(`  ${msg} Skipping.`);
} else {
  const setup = path.join(out, `EffortEstimation-Setup-${VERSION}.exe`);
  const flag = IS_WIN ? '/' : '-';
  run(makensis, [
    `${flag}V2`,
    `${flag}DVERSION=${VERSION}`,
    `${flag}DEXE=${exe}`,
    `${flag}DICON=${path.join(root, 'installer', 'app.ico')}`,
    `${flag}DOUTFILE=${setup}`,
    path.join(root, 'installer', 'installer.nsi'),
  ]);
  console.log(`  ${(statSync(setup).size / 1024 / 1024).toFixed(1)} MB`);
}

if (!KEEP) for (const f of [bundle, blob, seaConfig]) rmSync(f, { force: true });
step(`Done → ${path.relative(root, out)}`);

/** PE header offsets shared by the helpers below. */
function peLayout(buf) {
  const peOffset = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', peOffset, peOffset + 4) !== 'PE\0\0') throw new Error('Not a PE file');
  const optionalHeader = peOffset + 24;
  const isPE32Plus = buf.readUInt16LE(optionalHeader) === 0x20b;
  const dataDirectories = optionalHeader + (isPE32Plus ? 112 : 96);
  return { optionalHeader, dataDirectories };
}

/**
 * Removes the Authenticode signature: clears the security data directory and
 * cuts off the certificate table, which sits at the end of the file.
 */
function stripAuthenticodeSignature(buf) {
  const { dataDirectories } = peLayout(buf);
  const entry = dataDirectories + 4 * 8; // IMAGE_DIRECTORY_ENTRY_SECURITY
  const offset = buf.readUInt32LE(entry);
  const size = buf.readUInt32LE(entry + 4);
  if (!offset || !size) return buf; // not signed
  if (offset + size < buf.length - 8) throw new Error('Unexpected data after the certificate table');
  const out = Buffer.from(buf.subarray(0, offset));
  out.writeUInt32LE(0, entry);
  out.writeUInt32LE(0, entry + 4);
  return out;
}

/**
 * Switches the PE header from the console to the Windows GUI subsystem so the
 * app runs in the background without a console window.
 */
function setWindowsGuiSubsystem(file) {
  const buf = readFileSync(file);
  const { optionalHeader } = peLayout(buf);
  const SUBSYSTEM_OFFSET = 68; // same for PE32 and PE32+
  buf.writeUInt16LE(2, optionalHeader + SUBSYSTEM_OFFSET); // IMAGE_SUBSYSTEM_WINDOWS_GUI
  writeFileSync(file, buf);
}
