import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reduce, view, TEST_DELAY_S, type TestEvent, type TestState } from '../src/domain/testAlert.ts';

const run = (events: TestEvent[], from: TestState = { phase: 'idle' }) => events.reduce(reduce, from);
const ctx = { serverConfigured: true, serverConnected: true, now: 0 };

describe('test alert: transitions', () => {
  it('runs a server test to a received alert', () => {
    const s = run([
      { type: 'press', via: 'server', at: 1000 },
      { type: 'scheduled', arrivesAt: 11_000 },
      { type: 'arrived', at: 11_800 },
    ]);
    assert.equal(s.phase, 'received');
    assert.ok(s.phase === 'received' && Math.abs(s.lateBySeconds - 0.8) < 1e-9 && !s.whileClosed);
  });

  it('accepts a local alert that lands before its scheduling call returns', () => {
    const s = run([
      { type: 'press', via: 'local', at: 0 },
      { type: 'arrived', at: 50 },
      { type: 'scheduled', arrivesAt: 60 }, // late, and must be ignored
    ]);
    assert.equal(s.phase, 'received');
  });

  it('ignores a second press while a test is running', () => {
    const waiting = run([{ type: 'press', via: 'server', at: 0 }, { type: 'scheduled', arrivesAt: 10_000 }]);
    assert.equal(reduce(waiting, { type: 'press', via: 'local', at: 5 }), waiting);
  });

  it('gives up after the grace period, and a late banner still upgrades a miss', () => {
    const waiting = run([{ type: 'press', via: 'server', at: 0 }, { type: 'scheduled', arrivesAt: 10_000 }]);
    assert.equal(reduce(waiting, { type: 'tick', now: 29_000 }).phase, 'waiting');
    const missed = reduce(waiting, { type: 'tick', now: 30_001 });
    assert.equal(missed.phase, 'missed');
    const found = reduce(missed, { type: 'found-presented' });
    assert.ok(found.phase === 'received' && found.whileClosed);
  });

  it('times a local test out much sooner', () => {
    const waiting = run([{ type: 'press', via: 'local', at: 0 }, { type: 'scheduled', arrivesAt: 100 }]);
    assert.equal(reduce(waiting, { type: 'tick', now: 5_101 }).phase, 'missed');
  });

  it('only fails a test that is sending, and always allows a retry', () => {
    const failed = run([{ type: 'press', via: 'server', at: 0 }, { type: 'failed', reason: 'server', detail: 'Server responded 401' }]);
    assert.equal(failed.phase, 'failed');
    assert.equal(run([{ type: 'press', via: 'server', at: 9 }], failed).phase, 'sending');
    const received = run([{ type: 'press', via: 'local', at: 0 }, { type: 'arrived', at: 1 }]);
    assert.equal(reduce(received, { type: 'failed', reason: 'local' }), received);
  });

  it('resets to idle', () => {
    assert.equal(run([{ type: 'press', via: 'local', at: 0 }, { type: 'reset' }]).phase, 'idle');
  });
});

describe('test alert: what the user is told', () => {
  it('explains idle for each server situation', () => {
    assert.match(view({ phase: 'idle' }, ctx).note, /server sends it after 10 seconds/);
    assert.match(view({ phase: 'idle' }, { ...ctx, serverConnected: false }).note, /isn’t connected/);
    assert.equal(view({ phase: 'idle' }, { ...ctx, serverConfigured: false, serverConnected: false }).note, 'Fires on this phone right now.');
  });

  it('counts down while a server test is on its way', () => {
    const waiting: TestState = { phase: 'waiting', via: 'server', startedAt: 0, arrivesAt: 10_000 };
    const v = view(waiting, { ...ctx, now: 3_200 });
    assert.equal(v.label, 'ARRIVES IN 7s');
    assert.ok(v.busy && v.progress !== undefined && Math.abs(v.progress - 0.32) < 1e-9);
    assert.equal(view(waiting, { ...ctx, now: 10_400 }).label, 'ANY SECOND NOW…');
  });

  it('never leaves a failure unexplained, and offers Settings when that is the fix', () => {
    const reasons = ['permission', 'no-project', 'no-token', 'server', 'local'] as const;
    for (const reason of reasons) {
      const v = view({ phase: 'failed', reason }, ctx);
      assert.ok(v.note.length > 20, reason);
      assert.equal(v.tone, 'bad');
      assert.equal(v.action, reason === 'permission' ? 'open-settings' : undefined);
    }
    assert.match(view({ phase: 'failed', reason: 'server', detail: 'Server responded 401' }, ctx).note, /401/);
  });

  it('lists what to check when nothing arrives, with the server hint only for server tests', () => {
    const server = view({ phase: 'missed', via: 'server' }, ctx);
    const local = view({ phase: 'missed', via: 'local' }, ctx);
    assert.equal(server.tips.length, 3);
    assert.match(server.tips[2], /wrangler tail/);
    assert.equal(local.tips.length, 2);
    assert.equal(server.action, 'open-settings');
  });

  it('only claims closed-app success when the alert really arrived while closed', () => {
    const open = view({ phase: 'received', via: 'server', lateBySeconds: 0.4, whileClosed: false }, ctx);
    const closed = view({ phase: 'received', via: 'server', lateBySeconds: 0, whileClosed: true }, ctx);
    assert.doesNotMatch(open.note, /Closed-app alerts work/);
    assert.match(closed.note, /Closed-app alerts work/);
    assert.match(view({ phase: 'received', via: 'local', lateBySeconds: 0, whileClosed: false }, ctx).note, /Connect your server/);
    assert.equal(TEST_DELAY_S, 10);
  });
});
