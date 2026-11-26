import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';

test('delete moves an estimation to the trash and restore brings it back', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'ee-store-'));
  try {
    const store = createStore(path.join(data, 'estimations'));
    const a = await store.create({ customer: 'A', project: 'One', requirements: [{ puc: 'x', estimate: 2 }] });
    const b = await store.create({ customer: 'B', project: 'Two' });

    assert.equal(await store.remove(a.id), true);
    assert.equal(await store.get(a.id), null);
    assert.deepEqual((await store.list()).map((e) => e.id), [b.id]);
    assert.deepEqual(await readdir(path.join(data, 'trash')), [`${a.id}.json`]);

    assert.equal(await store.remove(a.id), false, 'deleting twice reports not found');

    const restored = await store.restore(a.id);
    assert.equal(restored.customer, 'A');
    assert.equal(restored.requirements[0].estimate, 2);
    assert.equal((await store.list()).length, 2);
    assert.equal(await store.restore(a.id), null, 'nothing left in the trash');
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});

test('rejects ids that are not UUIDs (no path traversal)', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'ee-store-'));
  try {
    const store = createStore(path.join(data, 'estimations'));
    await assert.rejects(() => store.remove('../config'), { status: 400 });
    await assert.rejects(() => store.restore('..%2Fx'), { status: 400 });
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});
