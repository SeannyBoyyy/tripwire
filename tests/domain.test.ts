// Pure app logic, run on plain Node: `npm test`. No React Native, no device needed.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyKey, fmtPrice, fmtTarget, groupDigits, parseTarget, roundNice, toInput, type KeyId } from '../src/domain/format.ts';
import { applyServerTrips } from '../src/domain/merge.ts';
import { crosses } from '../src/domain/rules.ts';

const type = (keys: string[], start = '') => keys.reduce((raw, k) => applyKey(raw, k as KeyId), start);

describe('crosses', () => {
  it('trips at or past the target, in the wire’s direction only', () => {
    assert.equal(crosses('below', 73000, 73000), true);
    assert.equal(crosses('below', 73000, 73000.01), false);
    assert.equal(crosses('above', 80, 80), true);
    assert.equal(crosses('above', 80, 79.99), false);
  });
});

describe('formatting', () => {
  it('keeps precision readable across price ranges', () => {
    assert.equal(fmtPrice(73412.5), '$73,412.50');
    assert.equal(fmtPrice(0.1834), '$0.1834');
    assert.equal(fmtPrice(0.00001234), '$0.00001234');
    assert.equal(fmtTarget(73000), '73,000');
  });
  it('parses what people type', () => {
    assert.equal(parseTarget('73,000'), 73000);
    assert.equal(parseTarget('73000.'), 73000);
    assert.equal(parseTarget(''), null);
    assert.equal(parseTarget('0'), null);
    assert.equal(parseTarget('abc'), null);
  });
  it('snaps quick picks to human steps and never prints scientific notation', () => {
    assert.equal(roundNice(73412.5 * 0.97), 71200);
    assert.equal(roundNice(2250.4 * 0.95), 2140);
    assert.equal(toInput(0.000001), '0.000001');
    assert.equal(toInput(71200), '71200');
  });
});

describe('keypad', () => {
  it('builds numbers and formats them as you type', () => {
    assert.equal(groupDigits(type(['7', '3', '0', '0', '0'])), '73,000');
    assert.equal(groupDigits(type(['1', '2', '3', '4', '5', '6', '7', '.', '5'])), '1,234,567.5');
    assert.equal(groupDigits('0.'), '0.');
  });
  it('rejects leading zeros, second dots and runaway lengths', () => {
    assert.equal(type(['0', '5']), '5');
    assert.equal(type(['.', '5']), '0.5');
    assert.equal(type(['1', '.', '2', '.']), '1.2');
    assert.equal(type(Array(12).fill('9')), '999999999');
    assert.equal(type(['0', '.', ...Array(12).fill('1')]), '0.11111111');
  });
  it('deletes one digit, or everything on clear', () => {
    assert.equal(type(['back'], '73'), '7');
    assert.equal(type(['back'], ''), '');
    assert.equal(type(['clear'], '73000'), '');
  });
});

describe('applyServerTrips', () => {
  const wire = (id: string, status: 'armed' | 'tripped' = 'armed') => ({
    id, coinId: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', direction: 'below' as const,
    target: 73000, startPrice: 73412.5, createdAt: 1, status,
  });
  const server = (id: string, status: 'armed' | 'tripped', price: number | null = null) => ({
    id, status, trippedAt: price === null ? null : 99, trippedPrice: price,
  });

  it('adopts a trip the server fired while the app was closed', () => {
    const [a] = applyServerTrips([wire('a')], [server('a', 'tripped', 72988.12)]);
    assert.equal(a.status, 'tripped');
    assert.equal(a.trippedPrice, 72988.12);
    assert.equal(a.trippedAt, 99);
  });
  it('leaves armed and already-tripped wires alone, and returns the same array when nothing changes', () => {
    const local = [wire('a'), wire('b', 'tripped')];
    assert.equal(applyServerTrips(local, [server('a', 'armed'), server('b', 'tripped', 1)]), local);
  });
  it('does not mutate its input', () => {
    const local = [wire('a')];
    applyServerTrips(local, [server('a', 'tripped', 1)]);
    assert.equal(local[0].status, 'armed');
  });
});
