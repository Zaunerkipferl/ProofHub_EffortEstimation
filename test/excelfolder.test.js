import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSettings, excelPathFor, safeName, suggestedFolder, writeExcelFile } from '../server/excelfolder.js';

const base = path.join(tmpdir(), 'OneDrive - Ing. Punzenberger COPA-DATA GmbH', 'Documents', 'Projekte');

test('builds <folder>/<customer>/<project>/EffortEstimation_<customer>_<project>.xlsx', () => {
  const cfg = { excelFolder: base, subfolderPattern: '{customer}/{project}' };
  assert.equal(
    excelPathFor(cfg, { customer: 'ACME', project: 'Line Monitor' }),
    path.join(base, 'ACME', 'Line Monitor', 'EffortEstimation_ACME_Line_Monitor.xlsx'),
  );
  // Windows-style separators in the pattern work too
  assert.equal(
    excelPathFor({ ...cfg, subfolderPattern: '{customer}\\{project}' }, { customer: 'ACME', project: 'Line Monitor' }),
    path.join(base, 'ACME', 'Line Monitor', 'EffortEstimation_ACME_Line_Monitor.xlsx'),
  );
  assert.equal(
    excelPathFor({ ...cfg, subfolderPattern: '{customer} - {project}' }, { customer: 'ACME', project: 'X' }),
    path.join(base, 'ACME - X', 'EffortEstimation_ACME_X.xlsx'),
  );
  assert.equal(excelPathFor({ ...cfg, subfolderPattern: '' }, { customer: 'A', project: 'B' }), path.join(base, 'EffortEstimation_A_B.xlsx'));
  assert.equal(excelPathFor({ excelFolder: '' }, { customer: 'A', project: 'B' }), null, 'off when no folder');
});

test('customer/project names cannot escape the folder or break Windows paths', () => {
  const cfg = { excelFolder: base, subfolderPattern: '{customer}/{project}' };
  const p = excelPathFor(cfg, { customer: '../../Windows', project: 'a:b*c?' });
  assert.ok(p.startsWith(base + path.sep), p);
  assert.equal(path.relative(base, p).split(path.sep)[0], '.._.._Windows');
  assert.ok(excelPathFor(cfg, { customer: '..Test', project: 'x' }).includes('..Test'), 'leading dots in a name are allowed');
  assert.equal(safeName('a:b*c?'), 'a_b_c_');
  assert.equal(safeName('..'), '_');
  assert.equal(safeName('CON'), 'CON_');
  assert.equal(safeName('Project. '), 'Project');
  assert.equal(safeName('  '), '_');
});

test('suggests the OneDrive for Business Documents\\Projekte folder', () => {
  const od = path.join(tmpdir(), 'OneDrive - Ing. Punzenberger COPA-DATA GmbH');
  assert.equal(suggestedFolder({ OneDriveCommercial: od, OneDrive: '/x' }), path.join(od, 'Documents', 'Projekte'));
  assert.equal(suggestedFolder({ OneDrive: od }), path.join(od, 'Documents', 'Projekte'));
});

test('settings validate folder and pattern, and persist', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ee-settings-'));
  try {
    const settings = createSettings(dir);
    assert.equal((await settings.get()).excelFolderAsked, false);
    await assert.rejects(() => settings.update({ excelFolder: 'relative\\folder' }), { status: 400 });
    await assert.rejects(() => settings.update({ subfolderPattern: '{customer}/../x' }), { status: 400 });
    const saved = await settings.update({ excelFolder: `"${base}"`, excelFolderAsked: true });
    assert.equal(saved.excelFolder, path.normalize(base), 'quotes from "Copy as path" are removed');
    assert.equal((await createSettings(dir).get()).excelFolder, path.normalize(base));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writes the file and creates missing folders', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ee-write-'));
  try {
    const target = path.join(dir, 'Projekte', 'ACME', 'Line Monitor', 'x.xlsx');
    await writeExcelFile(target, Buffer.from('PK test'));
    assert.equal(await readFile(target, 'utf8'), 'PK test');
    await writeExcelFile(target, Buffer.from('PK v2'));
    assert.equal(await readFile(target, 'utf8'), 'PK v2', 'overwrites on the next save');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
