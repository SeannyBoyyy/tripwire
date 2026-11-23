// How many wires fit in one sync, and what the app sends. The numbers live in two packages,
// so this keeps them in step, and runs what the app sends through the server's real validator.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { selectForSync } from '../src/domain/merge.ts';
import { MAX_ARMED, SYNC_LIMIT } from '../src/domain/rules.ts';
import type { Tripwire } from '../src/domain/types.ts';
import { MAX_WIRES, parseSyncBody } from '../server/src/core.ts';

const TOKEN = 'ExponentPushToken[abcdefghijklmnopqrstuv]';

const wire = (id: string, over: Partial<Tripwire> = {}): Tripwire => ({
  id,
  coinId: 'bitcoin',
  symbol: 'BTC',
  name: 'Bitcoin',
  direction: 'below',
  target: 73000,
  startPrice: 73412.5,
  createdAt: 1_700_000_000_000,
  status: 'armed',
  ...over,
});
const armed = (n: number) => Array.from({ length: n }, (_, i) => wire(`a${i}`));
// Trip times 1000, 1001, ...: a higher number is a newer trip.
const tripped = (n: number) =>
  Array.from({ length: n }, (_, i) => wire(`t${i}`, { status: 'tripped', trippedAt: 1000 + i, trippedPrice: 72000 }));

describe('sync limit', () => {
  it('matches what the server accepts, and leaves room for new trips', () => {
    assert.equal(SYNC_LIMIT, MAX_WIRES);
    assert.ok(MAX_ARMED < SYNC_LIMIT);
  });
});

describe('selectForSync', () => {
  it('sends everything, untouched, when it fits', () => {
    const list = [...armed(5), ...tripped(5)];
    assert.equal(selectForSync(list, SYNC_LIMIT), list);
  });

  it('keeps every armed wire and the newest trips when there are too many', () => {
    const room = SYNC_LIMIT - MAX_ARMED;
    const picked = selectForSync([...armed(MAX_ARMED), ...tripped(30)], SYNC_LIMIT);
    assert.equal(picked.length, SYNC_LIMIT);
    assert.equal(picked.filter((t) => t.status === 'armed').length, MAX_ARMED);
    const trips = picked.filter((t) => t.status === 'tripped').map((t) => t.trippedAt);
    assert.deepEqual(
      trips.sort(),
      Array.from({ length: room }, (_, i) => 1000 + 30 - room + i),
    );
  });

  it('never sends more than the limit, even with too many armed', () => {
    assert.equal(selectForSync(armed(SYNC_LIMIT + 5), SYNC_LIMIT).length, SYNC_LIMIT);
  });

  it('is accepted by the server where sending everything was not', () => {
    const many = [...armed(MAX_ARMED), ...tripped(30)];
    assert.equal(parseSyncBody({ token: TOKEN, tripwires: many }), null);
    assert.notEqual(parseSyncBody({ token: TOKEN, tripwires: selectForSync(many, SYNC_LIMIT) }), null);
  });
});
