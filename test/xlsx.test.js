import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { buildWorkbook, parseWorkbook, fileName } from '../server/xlsx.js';

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url));

test('parses the blank template', async () => {
  const est = await parseWorkbook(await fixture('EffortEstimation_CUSTOMER_PROJECT.xlsx'));
  assert.equal(est.customer, 'CUSTOMER');
  assert.equal(est.project, 'PROJECT');
  assert.equal(est.deliveryWeeks, 8);
  assert.equal(est.factor, 1);
  assert.deepEqual(est.requirements.map((r) => r.puc), ['Development Concept', 'General', 'Testing', 'Documentation']);
  assert.equal(est.requirements.reduce((s, r) => s + (r.estimate ?? 0), 0), 1.5);
});

test('parses the filled example, including manual numbers and an unnumbered row', async () => {
  const est = await parseWorkbook(await fixture('EffortEstimation_filled_example.xlsx'));
  assert.equal(est.customer, 'Lukas');
  assert.equal(est.project, 'dev academy');
  assert.equal(est.deliveryWeeks, 4);
  assert.equal(est.requirements.length, 9);
  assert.deepEqual(est.requirements.map((r) => r.number), [0, 1, 2, null, 3, 4, 5, 9, 10]);
  assert.equal(est.requirements[3].puc, '(OPTIONAL) Config UI');
  assert.equal(est.requirements.reduce((s, r) => s + (r.estimate ?? 0), 0), 7);
});

test('build -> parse round-trips and matches the template layout', async () => {
  const original = await parseWorkbook(await fixture('EffortEstimation_filled_example.xlsx'));
  const buf = await buildWorkbook({ ...original, factor: 1.5 });
  assert.deepEqual(await parseWorkbook(buf), { ...original, factor: 1.5 });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('REQ');
  assert.equal(ws.getCell('A1').value, 'Requirements Specification for: Lukas - dev academy');
  assert.equal(ws.getCell('A3').value, 'Requirement Number');
  assert.equal(ws.getCell('D17').value, 'Total Days Development');
  assert.equal(ws.getCell('E17').value.formula, 'SUM(E5:E16)');
  assert.equal(ws.getCell('E18').value.formula, 'E17 * 1.5');
  assert.equal(ws.getCell('D18').value, 'x1.5 (plus additional effort)');
  assert.equal(ws.getCell('F16').value, 'weeks');
  assert.match(ws.getCell('D20').value, /^delivery time in weeks/);
  assert.equal(ws.getCell('E20').value, 4);
});

test('totals move down when there are more requirements than template rows', async () => {
  const requirements = Array.from({ length: 20 }, (_, i) => ({ number: i, puc: `R${i}`, estimate: 1 }));
  const buf = await buildWorkbook({ customer: 'A', project: 'B', requirements });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('REQ');
  assert.equal(ws.getCell('D27').value, 'Total Days Development');
  assert.equal(ws.getCell('E27').value.formula, 'SUM(E5:E26)');
  assert.equal(ws.getCell('E27').value.result, 20);
  assert.equal((await parseWorkbook(buf)).requirements.length, 20);
});

test('file name is filesystem safe', () => {
  assert.equal(fileName({ customer: 'ACME / Inc.', project: 'Line 3' }), 'EffortEstimation_ACME_Inc_Line_3.xlsx');
});
