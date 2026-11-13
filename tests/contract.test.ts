// The app and the server are separate packages that must agree on one payload.
// This runs the app's real data through the server's real validator.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyServerTrips } from '../src/domain/merge.ts';
import { parseSyncBody } from '../server/src/core.ts';

const TOKEN = 'ExponentPushToken[abcdefghijklmnopqrstuv]';
const local = [
  { id: 'lq8x2k9a1b2c', coinId: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', direction: 'below' as const, target: 73000, startPrice: 73412.5, createdAt: 1_700_000_000_000, status: 'armed' as const },
  { id: 'lq8x2k9a3d4e', coinId: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche', direction: 'above' as const, target: 25.5, startPrice: 19.77, createdAt: 1_700_000_000_000, status: 'armed' as const },
  { id: 'lq8x2k9a5f6g', coinId: 'ethereum', symbol: 'ETH', name: 'Ethereum', direction: 'below' as const, target: 2000, startPrice: 2284.18, createdAt: 1_700_000_000_000, status: 'tripped' as const, trippedAt: 1_700_000_100_000, trippedPrice: 1999.5 },
];

describe('app <-> server contract', () => {
  it('the server accepts exactly what the app serialises', () => {
    // JSON round-trip: optional fields that are undefined disappear, as in a real request
    const body = JSON.parse(JSON.stringify({ token: TOKEN, tripwires: local }));
    const parsed = parseSyncBody(body);
    assert.equal(parsed?.wires.length, 3);
    assert.equal(parsed?.wires[2].trippedPrice, 1999.5);
  });

  it('what the server answers merges back into the app’s state', () => {
    const answer = [
      { id: 'lq8x2k9a1b2c', status: 'tripped' as const, trippedAt: 1_700_000_500_000, trippedPrice: 72988.12 },
      { id: 'lq8x2k9a3d4e', status: 'armed' as const, trippedAt: null, trippedPrice: null },
    ];
    const merged = applyServerTrips(local, answer);
    assert.equal(merged[0].status, 'tripped');
    assert.equal(merged[1].status, 'armed');
    assert.equal(merged[2].trippedPrice, 1999.5);
  });
});
