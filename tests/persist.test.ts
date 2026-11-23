// Reading the saved list: a failed read must never look like "no tripwires".
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readList, StorageReadError, type KeyValueStore } from '../src/domain/persist.ts';

const KEY = 'tripwire.items.v1';

/** A fake store holding `raw`, or failing the read when given an Error. Records every copy it is asked to save. */
function fakeStore(raw: string | null | Error, opts: { copyFails?: boolean } = {}) {
  const copies: [string, string][] = [];
  const store: KeyValueStore = {
    getItem: async () => {
      if (raw instanceof Error) throw raw;
      return raw;
    },
    setItem: async (key, value) => {
      if (opts.copyFails) throw new Error('disk full');
      copies.push([key, value]);
    },
  };
  return { store, copies };
}

describe('readList', () => {
  it('reads nothing saved yet as an empty list', async () => {
    assert.deepEqual(await readList(fakeStore(null).store, KEY), []);
  });

  it('returns the saved list', async () => {
    const saved = [{ id: 'a', status: 'armed' }];
    assert.deepEqual(await readList(fakeStore(JSON.stringify(saved)).store, KEY), saved);
  });

  it('throws when the read fails, instead of returning an empty list', async () => {
    const { store, copies } = fakeStore(new Error('storage unavailable'));
    await assert.rejects(readList(store, KEY), StorageReadError);
    assert.deepEqual(copies, []);
  });

  it('copies a value that is not JSON aside, then reads it as empty', async () => {
    const { store, copies } = fakeStore('{oops');
    assert.deepEqual(await readList(store, KEY), []);
    assert.deepEqual(copies, [[`${KEY}.unreadable`, '{oops']]);
  });

  it('treats JSON that is not a list the same way', async () => {
    const { store, copies } = fakeStore('{"a":1}');
    assert.deepEqual(await readList(store, KEY), []);
    assert.deepEqual(copies, [[`${KEY}.unreadable`, '{"a":1}']]);
  });

  it('still reads as empty when the copy cannot be saved', async () => {
    assert.deepEqual(await readList(fakeStore('{oops', { copyFails: true }).store, KEY), []);
  });
});
