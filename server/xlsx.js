// Builds and parses effort estimation workbooks that mirror the
// "EffortEstimation_CUSTOMER_PROJECT.xlsx" reference template (sheet "REQ").
import ExcelJS from 'exceljs';

export const REQUIREMENT_TYPES = [
  'Functional',
  'Constraint',
  'Look and Feel',
  'Usability',
  'Performance',
  'Operational',
  'Maintainability',
  'Security',
  'Cultural',
  'Legal',
];

const FIRST_DATA_ROW = 5;
// The template reserves rows 5..16 for requirements; totals start at row 17.
const MIN_LAST_DATA_ROW = 16;
// Data validation in the template reaches down to row 52.
const MIN_VALIDATION_ROW = 52;

const COLUMN_WIDTHS = { A: 13, B: 28.22, C: 15.11, D: 52.33, E: 30.66, F: 30.44, G: 11.44, H: 20, I: 20.11, J: 26 };

const thin = { style: 'thin' };
const medium = { style: 'medium' };
const verdana = (size = 10, bold = false) => ({ name: 'Verdana', size, bold });
const calibri = (bold = false, color) => ({ name: 'Calibri', size: 11, bold, ...(color ? { color: { argb: color } } : {}) });
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
const TOTAL_FONT_COLOR = 'FFFA7D00';

/** Normalised, safe copy of an estimation payload. */
export function normalizeEstimation(input = {}) {
  const num = (v, fallback = null) => {
    if (v === '' || v === null || v === undefined) return fallback;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : fallback;
  };
  const str = (v) => (v === null || v === undefined ? '' : String(v));
  return {
    customer: str(input.customer).trim(),
    project: str(input.project).trim(),
    factor: num(input.factor, 1),
    deliveryWeeks: num(input.deliveryWeeks, null),
    requirements: (Array.isArray(input.requirements) ? input.requirements : []).map((r) => ({
      number: num(r?.number, null),
      puc: str(r?.puc),
      type: str(r?.type),
      description: str(r?.description),
      estimate: num(r?.estimate, null),
    })),
  };
}

export function sheetTitle(est) {
  const parts = [est.customer, est.project].filter(Boolean);
  return `Requirements Specification for: ${parts.join(' - ')}`;
}

export function fileName(est) {
  const clean = (s) => s.replace(/[^\p{L}\p{N}\-]+/gu, '_').replace(/^_+|_+$/g, '');
  const parts = [clean(est.customer || 'CUSTOMER'), clean(est.project || 'PROJECT')];
  return `EffortEstimation_${parts.join('_')}.xlsx`;
}

/** Returns an xlsx Buffer for the given estimation. */
export async function buildWorkbook(input) {
  const est = normalizeEstimation(input);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Effort Estimation Tool';
  wb.created = new Date();
  const ws = wb.addWorksheet('REQ', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 4, topLeftCell: 'A5' }],
  });

  for (const [col, width] of Object.entries(COLUMN_WIDTHS)) ws.getColumn(col).width = width;

  // --- Title (A1:E2 merged) ---
  ws.mergeCells('A1:E2');
  const title = ws.getCell('A1');
  title.value = sheetTitle(est);
  title.font = verdana(12, true);
  title.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  for (const col of ['A', 'B', 'C', 'D', 'E']) {
    ws.getCell(`${col}1`).border = {
      top: medium,
      bottom: thin,
      left: col === 'A' ? medium : undefined,
      right: col === 'E' ? medium : undefined,
    };
  }
  ws.getRow(1).height = 15;

  // --- Header rows 3 + 4 ---
  const headers = ['Requirement Number', 'Product Use Case (PUC)', 'Requirement Type', 'Description', 'Estimate'];
  const hints = [
    'Unique identifier',
    'Name of the PUC',
    'Functional',
    'A one sentence text description of the requirement.',
    'Time estimated developed by COPA-DATA in Days',
  ];
  headers.forEach((text, i) => {
    const col = String.fromCharCode(65 + i);
    const border = (bottom) => ({
      top: thin,
      bottom,
      left: i === 0 ? medium : thin,
      right: i === 4 ? medium : thin,
    });
    const h = ws.getCell(`${col}3`);
    h.value = text;
    h.font = verdana(10, true);
    h.alignment = { vertical: 'top', wrapText: true };
    h.border = border(thin);
    const s = ws.getCell(`${col}4`);
    s.value = hints[i];
    s.font = verdana(10);
    s.alignment = { vertical: 'top', wrapText: true };
    s.border = border(medium);
    s.numFmt = '@';
  });
  ws.getRow(3).height = 50.4;
  ws.getRow(4).height = 38.4;

  // --- Requirement rows ---
  const reqs = est.requirements;
  const lastDataRow = Math.max(MIN_LAST_DATA_ROW, FIRST_DATA_ROW + reqs.length + 1);
  reqs.forEach((r, i) => {
    const row = ws.getRow(FIRST_DATA_ROW + i);
    const cells = {
      A: { value: r.number, alignment: { horizontal: 'left', vertical: 'top' }, numFmt: '0' },
      B: { value: r.puc || null, alignment: { horizontal: 'left', vertical: 'top', wrapText: true } },
      C: { value: r.type || null, alignment: { horizontal: 'left', vertical: 'top' } },
      D: { value: r.description || null, alignment: { horizontal: 'left', vertical: 'top', wrapText: true } },
      E: { value: r.estimate, alignment: { horizontal: 'right', vertical: 'top' }, numFmt: '0.0#' },
    };
    for (const [col, spec] of Object.entries(cells)) {
      const c = row.getCell(col);
      c.value = spec.value ?? null;
      c.font = calibri();
      c.alignment = spec.alignment;
      if (spec.numFmt) c.numFmt = spec.numFmt;
    }
    // Approximate row height from the description so wrapped text is visible.
    const lines = Math.max(
      estimateLines(r.description, 52),
      estimateLines(r.puc, 28),
    );
    if (lines > 1) row.height = Math.min(409, lines * 14.4 + 4);
  });

  // --- Totals ---
  const totalRow = lastDataRow + 1;
  const factorRow = totalRow + 1;
  const deliveryRow = totalRow + 3;
  const sumRange = `E${FIRST_DATA_ROW}:E${lastDataRow}`;
  const totalDays = reqs.reduce((s, r) => s + (r.estimate ?? 0), 0);

  const weeksLabel = ws.getCell(`F${lastDataRow}`);
  weeksLabel.value = 'weeks';
  weeksLabel.font = verdana(10);
  weeksLabel.alignment = { horizontal: 'right', vertical: 'top', wrapText: true };

  const totalStyle = (cell, numFmt) => {
    cell.font = calibri(true, TOTAL_FONT_COLOR);
    cell.fill = TOTAL_FILL;
    cell.alignment = { vertical: 'top', wrapText: true };
    cell.border = { top: thin, bottom: thin, left: thin, right: thin };
    if (numFmt) cell.numFmt = numFmt;
  };
  const weeksStyle = (cell) => {
    cell.font = verdana(10);
    cell.alignment = { horizontal: 'right', vertical: 'top', wrapText: true };
    cell.numFmt = '0.0';
  };

  ws.getCell(`D${totalRow}`).value = 'Total Days Development';
  totalStyle(ws.getCell(`D${totalRow}`));
  ws.getCell(`E${totalRow}`).value = { formula: `SUM(${sumRange})`, result: totalDays };
  totalStyle(ws.getCell(`E${totalRow}`), '0.0');
  ws.getCell(`F${totalRow}`).value = { formula: `E${totalRow}/5`, result: totalDays / 5 };
  weeksStyle(ws.getCell(`F${totalRow}`));

  ws.getCell(`D${factorRow}`).value = `x${formatNumber(est.factor)} (plus additional effort)`;
  totalStyle(ws.getCell(`D${factorRow}`));
  ws.getCell(`E${factorRow}`).value = {
    formula: `E${totalRow} * ${est.factor}`,
    result: totalDays * est.factor,
  };
  totalStyle(ws.getCell(`E${factorRow}`), '0.0');
  ws.getCell(`F${factorRow}`).value = { formula: `E${factorRow}/5`, result: (totalDays * est.factor) / 5 };
  weeksStyle(ws.getCell(`F${factorRow}`));

  const dl = ws.getCell(`D${deliveryRow}`);
  dl.value = 'delivery time in weeks from order date on and technical specification clear';
  dl.font = verdana(10, true);
  dl.alignment = { vertical: 'top', wrapText: true };
  const dv = ws.getCell(`E${deliveryRow}`);
  dv.value = est.deliveryWeeks;
  dv.font = verdana(10, true);
  dv.alignment = { vertical: 'top', wrapText: true };
  dv.numFmt = '0.0';
  ws.getRow(deliveryRow).height = 25.2;

  // --- Data validation (same as template) ---
  const validationEnd = Math.max(MIN_VALIDATION_ROW, deliveryRow);
  ws.dataValidations.add(`C${FIRST_DATA_ROW}:C${validationEnd}`, {
    type: 'list',
    allowBlank: true,
    formulae: [`"${REQUIREMENT_TYPES.join(', ')}"`],
  });
  ws.dataValidations.add(`A${FIRST_DATA_ROW}:A${lastDataRow}`, {
    type: 'whole',
    operator: 'greaterThanOrEqual',
    allowBlank: true,
    formulae: [0],
  });

  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: `A1:F${deliveryRow}` };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Parses an uploaded workbook (template layout) back into an estimation object. */
export async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('REQ') ?? wb.worksheets[0];
  if (!ws) throw new Error('The workbook contains no worksheets.');

  const text = (cell) => {
    const v = cell.value;
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') {
      if ('richText' in v) return v.richText.map((t) => t.text).join('');
      if ('result' in v) return v.result === undefined || v.result === null ? '' : String(v.result);
      if ('text' in v) return String(v.text);
    }
    return String(v);
  };
  const numberOf = (cell) => {
    const v = cell.value;
    if (typeof v === 'number') return v;
    if (v && typeof v === 'object' && typeof v.result === 'number') return v.result;
    const t = text(cell).trim().replace(',', '.');
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  // Title "Requirements Specification for: CUSTOMER - PROJECT"
  let customer = '';
  let project = '';
  const titleMatch = text(ws.getCell('A1')).match(/for:\s*(.*)$/i);
  if (titleMatch) {
    const [c, ...rest] = titleMatch[1].split(' - ');
    customer = (c ?? '').trim();
    project = rest.join(' - ').trim();
  }

  // Locate the header row ("Requirement Number") to be tolerant of small layout shifts.
  let headerRow = 3;
  for (let r = 1; r <= 10; r++) {
    if (/requirement number/i.test(text(ws.getCell(`A${r}`)))) { headerRow = r; break; }
  }
  const firstData = headerRow + 2;

  const requirements = [];
  let factor = 1;
  let deliveryWeeks = null;
  for (let r = firstData; r <= ws.rowCount; r++) {
    const d = text(ws.getCell(`D${r}`)).trim();
    if (/^total days development/i.test(d)) {
      const f = ws.getCell(`E${r + 1}`).value;
      const m = f && typeof f === 'object' && 'formula' in f ? String(f.formula).match(/\*\s*([\d.,]+)/) : null;
      if (m) factor = Number(m[1].replace(',', '.'));
      for (let k = r + 1; k <= Math.min(ws.rowCount, r + 8); k++) {
        if (/^delivery time/i.test(text(ws.getCell(`D${k}`)).trim())) {
          deliveryWeeks = numberOf(ws.getCell(`E${k}`));
          break;
        }
      }
      break;
    }
    const puc = text(ws.getCell(`B${r}`));
    const type = text(ws.getCell(`C${r}`));
    const estimate = numberOf(ws.getCell(`E${r}`));
    if (!puc.trim() && !type.trim() && !d && estimate === null) continue; // blank row
    requirements.push({ number: numberOf(ws.getCell(`A${r}`)), puc, type, description: text(ws.getCell(`D${r}`)), estimate });
  }

  return normalizeEstimation({ customer, project, factor, deliveryWeeks, requirements });
}

function estimateLines(textValue, widthChars) {
  if (!textValue) return 1;
  return String(textValue)
    .split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / (widthChars * 1.1))), 0);
}

function formatNumber(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
