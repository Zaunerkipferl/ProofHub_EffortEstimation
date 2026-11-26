// Minimal JSON-file store for estimations. One file per estimation keeps it
// easy to back up and avoids a database dependency for an intranet tool.
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { normalizeEstimation } from './xlsx.js';

const ID_RE = /^[0-9a-f-]{36}$/;

// Deleted estimations are moved to <dataDir>/trash instead of being erased,
// so a delete can be undone (and recovered by hand later if needed).
export function createStore(dir) {
  const trashDir = path.join(path.dirname(dir), 'trash');
  const ready = Promise.all([mkdir(dir, { recursive: true }), mkdir(trashDir, { recursive: true })]);
  const checkId = (id) => {
    if (!ID_RE.test(id)) throw Object.assign(new Error('Invalid id'), { status: 400 });
    return `${id}.json`;
  };
  const fileFor = (id) => path.join(dir, checkId(id));
  const trashFor = (id) => path.join(trashDir, checkId(id));
  const move = async (from, to) => {
    try {
      await rename(from, to);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  };

  async function read(id) {
    await ready;
    try {
      return JSON.parse(await readFile(fileFor(id), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async function write(record) {
    await ready;
    const target = fileFor(record.id);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(record, null, 2));
    await rename(tmp, target); // atomic replace
    return record;
  }

  return {
    async list() {
      await ready;
      const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
      const records = await Promise.all(files.map((f) => read(f.slice(0, -5)).catch(() => null)));
      return records
        .filter(Boolean)
        .map(({ id, customer, project, updatedAt, proofhub, excelFile, requirements }) => ({
          id,
          customer,
          project,
          updatedAt,
          proofhub: proofhub ?? null,
          excelFile: excelFile ?? null,
          totalDays: requirements.reduce((s, r) => s + (r.estimate ?? 0), 0),
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    get: read,
    async create(data) {
      const now = new Date().toISOString();
      return write({ id: randomUUID(), ...normalizeEstimation(data), proofhub: null, createdAt: now, updatedAt: now });
    },
    async update(id, data) {
      const existing = await read(id);
      if (!existing) return null;
      return write({
        ...existing,
        ...normalizeEstimation(data),
        id,
        updatedAt: new Date().toISOString(),
      });
    },
    /** Updates only the ProofHub link metadata (used by the later upload step). */
    async setProofhub(id, proofhub) {
      const existing = await read(id);
      if (!existing) return null;
      return write({ ...existing, proofhub });
    },
    /** Remembers where the Excel copy of this estimation was written last. */
    async setExcelFile(id, excelFile) {
      const existing = await read(id);
      if (!existing) return null;
      return write({ ...existing, excelFile });
    },
    /** Moves the estimation to the trash. Returns false if it does not exist. */
    async remove(id) {
      await ready;
      return move(fileFor(id), trashFor(id));
    },
    /** Brings a deleted estimation back from the trash. Returns it, or null. */
    async restore(id) {
      await ready;
      if (!(await move(trashFor(id), fileFor(id)))) return null;
      return read(id);
    },
  };
}
