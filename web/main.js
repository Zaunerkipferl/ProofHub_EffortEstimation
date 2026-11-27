import '@fontsource/noto-sans/400.css';
import '@fontsource/noto-sans/500.css';
import '@fontsource/ubuntu/400.css';
import '@fontsource/ubuntu/500.css';
import 'material-symbols/outlined.css';
import '@material/web/button/filled-button.js';
import '@material/web/button/filled-tonal-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/text-button.js';
import '@material/web/dialog/dialog.js';
import '@material/web/icon/icon.js';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/list/list.js';
import '@material/web/list/list-item.js';
import '@material/web/select/outlined-select.js';
import '@material/web/select/select-option.js';
import '@material/web/switch/switch.js';
import '@material/web/textfield/outlined-text-field.js';
import { styles as typescaleStyles } from '@material/web/typography/md-typescale-styles.js';
import './theme.css';
import './app.css';

document.adoptedStyleSheets.push(typescaleStyles.styleSheet);

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let keySeq = 0;
let requirementTypes = [];
let saved = [];
let state = blankEstimation();
let dirty = false;

// ---------------------------------------------------------------------------
// Browser memory (per browser/device): theme, last opened estimation and an
// unsaved draft. Storage can be blocked (private mode, policies), so every
// access is guarded and the app works without it.
// ---------------------------------------------------------------------------
const KEYS = { theme: 'ee.theme', lastOpen: 'ee.lastOpenId', draft: 'ee.draft' };
const memory = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch { /* storage unavailable */ }
  },
};

function readDraft() {
  try {
    const draft = JSON.parse(memory.get(KEYS.draft));
    return draft?.state?.requirements ? draft : null;
  } catch {
    return null;
  }
}

function saveDraftNow() {
  clearTimeout(draftTimer);
  const { requirements, ...rest } = state;
  memory.set(KEYS.draft, JSON.stringify({
    savedAt: new Date().toISOString(),
    state: { ...rest, requirements: requirements.map(({ key, ...r }) => r) },
  }));
}

let draftTimer;
function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    saveDraftNow();
    renderSaved();
  }, 400);
}

function clearDraft() {
  clearTimeout(draftTimer);
  memory.set(KEYS.draft, null);
}

// Theme ---------------------------------------------------------------------
const systemDark = matchMedia('(prefers-color-scheme: dark)');
function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const next = theme === 'dark' ? 'light' : 'dark';
  const btn = $('themeBtn');
  btn.querySelector('md-icon').textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
  btn.title = btn.ariaLabel = `Switch to ${next} mode`;
}
// Follow the OS setting until the user picks a mode explicitly.
systemDark.addEventListener('change', (e) => {
  if (!memory.get(KEYS.theme)) applyTheme(e.matches ? 'dark' : 'light');
});

function blankEstimation() {
  // Mirrors the defaults of EffortEstimation_CUSTOMER_PROJECT.xlsx
  return {
    id: null,
    customer: '',
    project: '',
    factor: 1,
    deliveryWeeks: 8,
    autoNumber: true,
    proofhub: null,
    excelFile: null,
    updatedAt: null,
    requirements: [
      req({ puc: 'Development Concept' }),
      req({ puc: 'General', description: 'Version:\nOperating System: Windows' }),
      req({ puc: 'Testing', description: 'basic functionality testing without any test documentation', estimate: 1 }),
      req({ puc: 'Documentation', description: 'release notes only in English with short usage description', estimate: 0.5 }),
    ],
  };
}

function req(r = {}) {
  return { key: ++keySeq, number: null, puc: '', type: '', description: '', estimate: null, ...r };
}

const TRAILING_PUCS = /^(testing|documentation)$/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const fmt = (n) =>
  n === null || n === undefined || Number.isNaN(n)
    ? '–'
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);

/** "1 day", "2.5 days" */
const count = (n, unit) => `${fmt(n)} ${n === 1 ? unit : `${unit}s`}`;

const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function payload() {
  applyAutoNumber();
  return {
    customer: state.customer,
    project: state.project,
    factor: state.factor ?? 1,
    deliveryWeeks: state.deliveryWeeks,
    requirements: state.requirements.map(({ number, puc, type, description, estimate }) => ({
      number, puc, type, description, estimate,
    })),
  };
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  const type = res.headers.get('Content-Type') ?? '';
  return type.includes('application/json') ? res.json() : res;
}

let snackTimer;
let snackAction = null;
/** Shows a message; `action` = { label, onClick } adds a button (e.g. Undo). */
function toast(message, isError = false, action = null) {
  const el = $('snackbar');
  const btn = $('snackbarAction');
  $('snackbarText').textContent = message;
  snackAction = action?.onClick ?? null;
  btn.hidden = !action;
  btn.textContent = action?.label ?? '';
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(hideToast, action ? 8000 : isError ? 6000 : 3000);
}
function hideToast() {
  clearTimeout(snackTimer);
  snackAction = null;
  $('snackbar').classList.remove('show');
}

function confirmDialog(headline, text, okLabel = 'OK', { danger = false } = {}) {
  const dialog = $('confirmDialog');
  $('confirmHeadline').textContent = headline;
  $('confirmText').textContent = text;
  $('confirmOk').textContent = okLabel;
  $('confirmOk').classList.toggle('danger', danger);
  dialog.returnValue = '';
  dialog.show();
  return new Promise((resolve) => {
    dialog.addEventListener('closed', () => resolve(dialog.returnValue === 'ok'), { once: true });
  });
}

function markDirty(value = true) {
  dirty = value;
  if (dirty) scheduleDraftSave();
  else clearDraft();
  renderStatus();
}

function when(iso) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return `today, ${time}`;
  return `${d.toLocaleDateString()}, ${time}`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function applyAutoNumber() {
  if (!state.autoNumber) return;
  state.requirements.forEach((r, i) => { r.number = i; });
}

function renderAll() {
  $('customer').value = state.customer;
  $('project').value = state.project;
  $('deliveryWeeks').value = state.deliveryWeeks ?? '';
  $('factor').value = state.factor ?? 1;
  $('autoNumber').selected = state.autoNumber;
  renderRequirements();
  renderSummary();
  renderStatus();
  renderSaved();
}

function renderStatus() {
  const parts = [state.customer, state.project].filter(Boolean);
  $('sheetTitle').textContent = `Requirements Specification for: ${parts.length ? parts.join(' - ') : 'CUSTOMER - PROJECT'}`;
  let status;
  if (!state.id) status = 'New estimation, not saved yet';
  else status = `Saved ${new Date(state.updatedAt).toLocaleString()}`;
  if (dirty && state.id) status += ' · unsaved changes';
  $('statusLine').textContent = status;
  $('deleteBtn').hidden = !state.id;
  renderFileLine();
  document.title = `${dirty ? '• ' : ''}${parts.join(' - ') || 'Effort Estimation'}`;
}

function renderSummary() {
  const total = state.requirements.reduce((s, r) => s + (r.estimate ?? 0), 0);
  const factor = state.factor ?? 1;
  $('totalDays').textContent = count(total, 'day');
  $('totalWeeks').textContent = count(total / 5, 'week');
  $('factorLabel').textContent = `× ${fmt(factor)} (plus additional effort)`;
  $('factorDays').textContent = count(total * factor, 'day');
  $('factorWeeks').textContent = count((total * factor) / 5, 'week');
  $('deliveryOut').textContent = fmt(state.deliveryWeeks);
}

function textField({ label, value, field, type = 'text', extra = {} }) {
  const tf = document.createElement('md-outlined-text-field');
  tf.label = label;
  tf.type = type;
  tf.dataset.field = field;
  Object.assign(tf, extra);
  tf.value = value ?? '';
  return tf;
}

function iconButton(icon, label, action, disabled = false) {
  const b = document.createElement('md-icon-button');
  b.innerHTML = `<md-icon>${icon}</md-icon>`;
  b.title = label;
  b.ariaLabel = label;
  b.dataset.action = action;
  b.disabled = disabled;
  return b;
}

function renderRequirements(focusKey) {
  applyAutoNumber();
  const list = $('reqList');
  list.replaceChildren();
  if (!state.requirements.length) {
    const p = document.createElement('p');
    p.className = 'req-empty muted md-typescale-body-medium';
    p.textContent = 'No requirements yet. Add the first one below.';
    list.append(p);
  }
  state.requirements.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'req-row';
    row.dataset.key = r.key;

    const num = textField({
      label: 'No.', value: r.number, field: 'number', type: 'number',
      extra: { min: '0', step: '1', disabled: state.autoNumber },
    });
    const puc = textField({ label: 'Product use case', value: r.puc, field: 'puc' });

    const type = document.createElement('md-outlined-select');
    type.label = 'Type';
    type.dataset.field = 'type';
    const types = r.type && !requirementTypes.includes(r.type) ? [...requirementTypes, r.type] : requirementTypes;
    type.innerHTML =
      '<md-select-option value=""><div slot="headline">–</div></md-select-option>' +
      types.map((t) => `<md-select-option value="${escapeHtml(t)}"><div slot="headline">${escapeHtml(t)}</div></md-select-option>`).join('');
    type.value = r.type;
    // The select renders its options asynchronously; set the value again once ready.
    type.updateComplete?.then(() => { type.value = r.type; });

    const desc = textField({
      label: 'Description', value: r.description, field: 'description', type: 'textarea',
      extra: { rows: Math.min(8, Math.max(2, (r.description.match(/\n/g)?.length ?? 0) + 1, Math.ceil(r.description.length / 70))) },
    });
    const est = textField({
      label: 'Days', value: r.estimate, field: 'estimate', type: 'number', extra: { min: '0', step: '0.5' },
    });

    const actions = document.createElement('div');
    actions.className = 'req-actions';
    actions.append(
      iconButton('arrow_upward', 'Move up', 'up', i === 0),
      iconButton('arrow_downward', 'Move down', 'down', i === state.requirements.length - 1),
      iconButton('delete', 'Delete requirement', 'delete'),
    );

    row.append(num, puc, type, desc, est, actions);
    list.append(row);
  });

  if (focusKey !== undefined) {
    const field = list.querySelector(`.req-row[data-key="${focusKey}"] [data-field="puc"]`);
    field?.updateComplete?.then(() => field.focus());
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function renderSaved() {
  const q = $('search').value.trim().toLowerCase();
  const items = saved.filter((s) => !q || `${s.customer} ${s.project}`.toLowerCase().includes(q));
  const list = $('savedList');
  const draft = readDraft();
  list.replaceChildren(
    ...items.map((s) => {
      const row = document.createElement('div');
      row.className = 'saved-row';
      row.setAttribute('role', 'listitem');
      if (s.id === state.id) row.setAttribute('aria-current', 'true');
      const li = document.createElement('md-list-item');
      li.type = 'button';
      li.dataset.id = s.id;
      const hasDraft = draft?.state?.id === s.id;
      const icon = hasDraft ? 'edit_note' : s.proofhub ? 'cloud_done' : 'description';
      li.innerHTML = `
        <md-icon slot="start">${icon}</md-icon>
        <div slot="headline"></div>
        <div slot="supporting-text"></div>`;
      li.querySelector('[slot=headline]').textContent = estimationName(s);
      li.querySelector('[slot=supporting-text]').textContent = hasDraft
        ? `Unsaved changes · ${when(draft.savedAt)}`
        : `${count(s.totalDays, 'day')} · edited ${when(s.updatedAt)}`;
      li.title = `Last saved ${new Date(s.updatedAt).toLocaleString()}${s.excelFile ? `\n${s.excelFile}` : ''}`;
      const del = iconButton('delete', `Delete ${estimationName(s)}`, 'delete-saved');
      del.classList.add('saved-delete');
      del.dataset.deleteId = s.id;
      row.append(li, del);
      return row;
    }),
  );
  $('savedEmpty').hidden = items.length > 0;
  $('savedEmpty').textContent = saved.length ? 'No matches.' : 'Nothing saved yet.';
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function loadSaved() {
  try {
    saved = await api('/api/estimations');
    renderSaved();
  } catch (err) {
    toast(`Could not load saved estimations: ${err.message}`, true);
  }
}

function validate() {
  if (!state.customer || !state.project) {
    toast('Please enter a customer and project name.', true);
    (!state.customer ? $('customer') : $('project')).focus();
    return false;
  }
  return true;
}

async function save() {
  if (!validate()) return false;
  if (excelSettings && !excelSettings.excelFolderAsked) {
    // First save: ask where the Excel files should go. Cancel = save without asking again now.
    await openFolderDialog({ firstTime: true });
  }
  try {
    const body = JSON.stringify(payload());
    const record = state.id
      ? await api(`/api/estimations/${state.id}`, { method: 'PUT', body })
      : await api('/api/estimations', { method: 'POST', body });
    state.id = record.id;
    state.updatedAt = record.updatedAt;
    state.proofhub = record.proofhub;
    state.excelFile = record.excelFile ?? null;
    memory.set(KEYS.lastOpen, record.id);
    markDirty(false);
    renderFileLine();
    await loadSaved();
    if (record.excelError) {
      toast(`Saved in the tool, but the Excel file was not written. ${record.excelError}`, true);
    } else if (excelSettings?.excelFolder && record.excelFile) {
      toast(`Saved · ${fileNameOf(record.excelFile)}`, false,
        excelSettings.local ? { label: 'Open folder', onClick: revealExcelFile } : null);
    } else {
      toast('Estimation saved.');
    }
    return true;
  } catch (err) {
    toast(`Saving failed: ${err.message}`, true);
    return false;
  }
}

async function exportXlsx() {
  if (!validate()) return;
  try {
    const res = await api('/api/export', { method: 'POST', body: JSON.stringify(payload()) });
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const name = decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? 'EffortEstimation.xlsx');
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exported ${name}`);
  } catch (err) {
    toast(`Export failed: ${err.message}`, true);
  }
}

async function guardUnsaved() {
  if (!dirty) return true;
  return confirmDialog('Discard changes?', 'The current estimation has unsaved changes that will be lost.', 'Discard');
}

async function newEstimation() {
  if (!(await guardUnsaved())) return;
  state = blankEstimation();
  memory.set(KEYS.lastOpen, null);
  markDirty(false);
  renderAll();
  closeSidebar();
  $('customer').focus();
}

async function openSaved(id) {
  if (id === state.id) return closeSidebar();
  if (!(await guardUnsaved())) return;
  try {
    const record = await api(`/api/estimations/${id}`);
    state = fromRecord(record);
    memory.set(KEYS.lastOpen, record.id);
    markDirty(false);
    renderAll();
    closeSidebar();
  } catch (err) {
    toast(`Could not open estimation: ${err.message}`, true);
  }
}

function fromRecord(record) {
  const requirements = record.requirements.map((r) => req(r));
  // Keep manual numbering if the stored numbers differ from 0..n-1 (e.g. gaps).
  const sequential = requirements.every((r, i) => r.number === i);
  return { ...blankEstimation(), ...record, requirements, autoNumber: sequential };
}

async function importFile(file) {
  if (!(await guardUnsaved())) return;
  const form = new FormData();
  form.append('file', file);
  try {
    const data = await api('/api/import', { method: 'POST', body: form });
    state = fromRecord({ ...data, id: null, proofhub: null, updatedAt: null });
    renderAll();
    markDirty(true);
    toast(`Imported ${file.name} (${data.requirements.length} requirements). Save it to keep it in the list.`);
  } catch (err) {
    toast(`Import failed: ${err.message}`, true);
  }
}

async function deleteRequirement(index) {
  const r = state.requirements[index];
  const hasContent = r.puc || r.description || r.estimate !== null;
  if (hasContent && !(await confirmDialog('Delete requirement?', `“${r.puc || r.description.slice(0, 60)}” will be removed.`, 'Delete'))) return;
  state.requirements.splice(index, 1);
  renderRequirements();
  renderSummary();
  markDirty();
}

function addRequirement() {
  // Insert before trailing Testing / Documentation rows, as in the template.
  let at = state.requirements.length;
  while (at > 0 && TRAILING_PUCS.test(state.requirements[at - 1].puc.trim())) at--;
  const r = req({ type: 'Functional' });
  state.requirements.splice(at, 0, r);
  renderRequirements(r.key);
  renderSummary();
  markDirty();
}

const estimationName = (e) => [e.customer, e.project].filter(Boolean).join(' - ') || 'Untitled';

async function deleteEstimation(id) {
  const summary = saved.find((s) => s.id === id) ?? (state.id === id ? state : null);
  const name = summary ? estimationName(summary) : 'this estimation';
  const isOpen = state.id === id;
  let text = `“${name}” will be removed from the saved estimations for everyone using this tool. Excel files you already exported are not affected.`;
  if (isOpen && dirty) text += ' Your unsaved changes to it will be lost.';
  if (summary?.proofhub) text += ' The copy in ProofHub is not deleted.';
  if (!(await confirmDialog('Delete estimation?', text, 'Delete', { danger: true }))) return;

  try {
    await api(`/api/estimations/${id}`, { method: 'DELETE' });
  } catch (err) {
    // Already gone (deleted elsewhere): just refresh the list.
    if (!/not found/i.test(err.message)) return toast(`Delete failed: ${err.message}`, true);
  }

  if (readDraft()?.state?.id === id) clearDraft();
  if (isOpen) {
    state = blankEstimation();
    memory.set(KEYS.lastOpen, null);
    dirty = false;
    renderAll();
  }
  await loadSaved();
  toast(`Deleted “${name}”.`, false, { label: 'Undo', onClick: () => restoreEstimation(id, isOpen) });
}

async function restoreEstimation(id, reopen) {
  try {
    const record = await api(`/api/estimations/${id}/restore`, { method: 'POST' });
    // Reopen it only if the user has not started something else meanwhile.
    if (reopen && !state.id && !dirty) {
      state = fromRecord(record);
      memory.set(KEYS.lastOpen, id);
      renderAll();
    }
    await loadSaved();
    toast(`Restored “${estimationName(record)}”.`);
  } catch (err) {
    toast(`Could not restore: ${err.message}`, true);
  }
}

// ---------------------------------------------------------------------------
// Excel folder: where saved estimations are written as .xlsx
// ---------------------------------------------------------------------------
let excelSettings = null;

async function loadExcelSettings() {
  try {
    excelSettings = await api('/api/settings');
  } catch (err) {
    excelSettings = null;
    console.warn('Settings unavailable:', err.message);
  }
}

const fileNameOf = (p) => p.split(/[\\/]/).pop();

function renderFileLine() {
  const file = state.excelFile;
  $('fileLine').hidden = !file;
  if (!file) return;
  $('filePath').textContent = file;
  $('filePath').title = file;
  $('revealBtn').hidden = !excelSettings?.local || !state.id;
}

async function revealExcelFile() {
  if (!state.id) return;
  try {
    await api('/api/desktop/reveal', { method: 'POST', body: JSON.stringify({ id: state.id }) });
  } catch (err) {
    toast(`Could not open the folder: ${err.message}`, true);
  }
}

async function copyExcelPath() {
  try {
    await navigator.clipboard.writeText(state.excelFile);
    toast('Path copied.');
  } catch {
    // Clipboard API needs https or localhost; fall back to selecting the text.
    const range = document.createRange();
    range.selectNodeContents($('filePath'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    toast('Press Ctrl+C to copy the selected path.');
  }
}

let previewTimer;
function updateFolderPreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const folder = $('folderInput').value.trim();
    if (!folder) {
      $('folderPreview').textContent = 'No Excel files will be saved.';
      return;
    }
    try {
      const { path: p } = await api('/api/settings/preview', {
        method: 'POST',
        body: JSON.stringify({
          settings: { excelFolder: folder.replace(/^"(.*)"$/, '$1'), subfolderPattern: $('patternInput').value },
          estimation: { customer: state.customer || 'Customer', project: state.project || 'Project' },
        }),
      });
      $('folderPreview').textContent = p ?? '–';
    } catch (err) {
      $('folderPreview').textContent = err.message;
    }
  }, 150);
}

/**
 * Asks for the Excel folder. firstTime: shown on the first save
 * ("Don't save Excel files" / "Save here"); otherwise it is the settings dialog.
 */
function openFolderDialog({ firstTime = false } = {}) {
  const dialog = $('folderDialog');
  const cfg = excelSettings ?? {};
  $('folderHeadline').textContent = firstTime ? 'Where should the Excel files be saved?' : 'Excel files';
  $('folderIntro').textContent = firstTime
    ? 'Each time you save, the estimation is also written as an Excel file into this folder. You can change this later with the folder button in the top bar.'
    : 'Each time you save, the estimation is also written as an Excel file into this folder. Leave the folder empty to only keep estimations in the tool.';
  $('folderInput').value = cfg.excelFolder || cfg.suggestedFolder || '';
  $('patternInput').value = cfg.subfolderPattern ?? '{customer}\\{project}';
  $('patternInput').value = $('patternInput').value.replaceAll('/', cfg.pathSeparator ?? '\\');
  $('browseBtn').hidden = !cfg.canBrowse;
  $('folderOffBtn').hidden = !firstTime && !cfg.excelFolder;
  $('folderOffBtn').textContent = firstTime ? "Don't save Excel files" : 'Turn off';
  $('folderOkBtn').textContent = firstTime ? 'Save here' : 'Save';
  $('folderError').hidden = true;
  updateFolderPreview();

  return new Promise((resolve) => {
    let result = 'cancel';
    const submit = async (patch, outcome) => {
      try {
        excelSettings = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ ...patch, excelFolderAsked: true }) });
        result = outcome;
        dialog.close();
      } catch (err) {
        $('folderError').textContent = err.message;
        $('folderError').hidden = false;
      }
    };
    const onOk = () => submit({ excelFolder: $('folderInput').value, subfolderPattern: $('patternInput').value }, 'saved');
    const onOff = () => submit({ excelFolder: '' }, 'off');
    const onCancel = () => dialog.close();
    const onBrowse = async () => {
      $('browseBtn').disabled = true;
      try {
        const { folder } = await api('/api/desktop/pick-folder', {
          method: 'POST',
          body: JSON.stringify({ initial: $('folderInput').value.trim() }),
        });
        if (folder) {
          $('folderInput').value = folder;
          updateFolderPreview();
        }
      } catch (err) {
        $('folderError').textContent = `${err.message} You can type or paste the path instead.`;
        $('folderError').hidden = false;
      } finally {
        $('browseBtn').disabled = false;
      }
    };
    const controls = [['folderOkBtn', onOk], ['folderOffBtn', onOff], ['folderCancelBtn', onCancel], ['browseBtn', onBrowse]];
    controls.forEach(([id, fn]) => $(id).addEventListener('click', fn));
    dialog.addEventListener('closed', () => {
      controls.forEach(([id, fn]) => $(id).removeEventListener('click', fn));
      resolve(result);
    }, { once: true });
    dialog.show();
  });
}

$('folderInput').addEventListener('input', updateFolderPreview);
$('patternInput').addEventListener('input', updateFolderPreview);
$('settingsBtn').addEventListener('click', async () => {
  if (!excelSettings) await loadExcelSettings();
  const result = await openFolderDialog();
  if (result === 'saved') toast(excelSettings.excelFolder ? 'Excel folder saved. It is used from the next save on.' : 'Excel files will not be saved.');
  if (result === 'off') toast('Excel files will not be saved anymore.');
});
$('revealBtn').addEventListener('click', revealExcelFile);
$('copyPathBtn').addEventListener('click', copyExcelPath);

// Sidebar (mobile drawer)
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('scrim').hidden = true;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
function bindProjectField(id, key, parse = (v) => v.trim()) {
  $(id).addEventListener('input', (e) => {
    state[key] = parse(e.target.value);
    renderSummary();
    markDirty();
  });
}

bindProjectField('customer', 'customer');
bindProjectField('project', 'project');
bindProjectField('deliveryWeeks', 'deliveryWeeks', toNum);
bindProjectField('factor', 'factor', (v) => toNum(v) ?? 1);

$('autoNumber').addEventListener('change', (e) => {
  state.autoNumber = e.target.selected;
  renderRequirements();
  markDirty();
});

const reqList = $('reqList');
const rowIndex = (el) => state.requirements.findIndex((r) => String(r.key) === el.closest('.req-row')?.dataset.key);

const onFieldChange = (e) => {
  const field = e.target.dataset?.field;
  if (!field) return;
  const i = rowIndex(e.target);
  if (i < 0) return;
  const value = e.target.value;
  state.requirements[i][field] = field === 'number' || field === 'estimate' ? toNum(value) : value;
  if (field === 'estimate') renderSummary();
  markDirty();
};
reqList.addEventListener('input', onFieldChange);
reqList.addEventListener('change', onFieldChange);

reqList.addEventListener('click', (e) => {
  const btn = e.target.closest('md-icon-button[data-action]');
  if (!btn) return;
  const i = rowIndex(btn);
  const { action } = btn.dataset;
  if (action === 'delete') return deleteRequirement(i);
  const j = action === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= state.requirements.length) return;
  const reqs = state.requirements;
  [reqs[i], reqs[j]] = [reqs[j], reqs[i]];
  renderRequirements();
  markDirty();
  reqList.querySelector(`.req-row[data-key="${reqs[j].key}"] [data-action="${action}"]`)?.focus();
});

applyTheme(currentTheme());
$('themeBtn').addEventListener('click', () => {
  const theme = currentTheme() === 'dark' ? 'light' : 'dark';
  memory.set(KEYS.theme, theme);
  applyTheme(theme);
});

$('addReqBtn').addEventListener('click', addRequirement);
$('saveBtn').addEventListener('click', save);
$('exportBtn').addEventListener('click', exportXlsx);
$('newBtn').addEventListener('click', newEstimation);
$('importBtn').addEventListener('click', () => $('importInput').click());
$('importInput').addEventListener('change', (e) => {
  const [file] = e.target.files;
  e.target.value = '';
  if (file) importFile(file);
});
$('search').addEventListener('input', renderSaved);
$('savedList').addEventListener('click', (e) => {
  const del = e.target.closest('[data-delete-id]');
  if (del) return deleteEstimation(del.dataset.deleteId);
  const item = e.target.closest('md-list-item[data-id]');
  if (item) openSaved(item.dataset.id);
});
$('deleteBtn').addEventListener('click', () => state.id && deleteEstimation(state.id));
$('snackbarAction').addEventListener('click', () => {
  const action = snackAction;
  hideToast();
  action?.();
});
$('navToggle').addEventListener('click', () => {
  const open = $('sidebar').classList.toggle('open');
  $('scrim').hidden = !open;
});
$('scrim').addEventListener('click', closeSidebar);

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  }
});
// Unsaved work is kept as a draft in this browser, so no "leave page?" prompt.
window.addEventListener('pagehide', () => {
  if (dirty) saveDraftNow();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async () => {
  try {
    const config = await api('/api/config');
    requirementTypes = config.requirementTypes;
    if (config.proofhub.configured) {
      $('proofhubText').textContent = 'ProofHub is connected. Upload and update will be enabled in the next step.';
    }
  } catch (err) {
    toast(`Server not reachable: ${err.message}`, true);
  }
  await loadExcelSettings();
  await restoreSession();
  renderAll();
  loadSaved();
})();

/** Restores unsaved work, otherwise reopens the estimation used last time. */
async function restoreSession() {
  const draft = readDraft();
  if (draft) {
    const { requirements, ...rest } = draft.state;
    state = { ...blankEstimation(), ...rest, requirements: requirements.map((r) => req(r)) };
    dirty = true;
    toast(`Restored your unsaved changes from ${when(draft.savedAt)}.`);
    return;
  }
  const lastId = memory.get(KEYS.lastOpen);
  if (!lastId) return;
  try {
    state = fromRecord(await api(`/api/estimations/${lastId}`));
  } catch {
    memory.set(KEYS.lastOpen, null); // deleted or unreachable: start fresh
  }
}
