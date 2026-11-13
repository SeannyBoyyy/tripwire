// Runs on plain Node (type stripping). D1 is faked with node:sqlite so the real SQL is exercised.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { crosses, fetchPrices, parseSyncBody, runTick, sendPushes, syncDevice, toMessage } from '../src/core.ts';

const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TOKEN_B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

function fakeD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) {
        params = values;
        return statement;
      },
      async run() {
        const r = sqlite.prepare(sql).run(...(params as never[]));
        return { success: true, meta: { changes: Number(r.changes) } };
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...(params as never[])) };
      },
    };
    return statement;
  };
  const db = {
    prepare,
    async batch(statements: { run(): Promise<unknown> }[]) {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const rows = (sql: string, ...params: unknown[]) => sqlite.prepare(sql).all(...(params as never[])) as any[];
  return { db: db as any, rows };
}

const wire = (over: Record<string, unknown> = {}) => ({
  id: 'w1',
  coinId: 'bitcoin',
  symbol: 'BTC',
  name: 'Bitcoin',
  direction: 'below',
  target: 73000,
  startPrice: 73412.5,
  createdAt: 1_700_000_000_000,
  status: 'armed',
  trippedAt: null,
  trippedPrice: null,
  ...over,
});

function mockFetch(opts: {
  prices?: Record<string, number>;
  geckoStatus?: number;
  push?: (messages: any[]) => Response;
}) {
  const calls: { url: string; body?: any }[] = [];
  const fn = async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.includes('coingecko')) {
      const body = Object.fromEntries(Object.entries(opts.prices ?? {}).map(([id, usd]) => [id, { usd }]));
      return new Response(JSON.stringify(body), { status: opts.geckoStatus ?? 200 });
    }
    if (url.includes('exp.host')) {
      const messages = JSON.parse(init?.body ?? '[]');
      return (
        opts.push?.(messages) ??
        new Response(JSON.stringify({ data: messages.map(() => ({ status: 'ok', id: 't' })) }))
      );
    }
    return new Response('not mocked', { status: 500 });
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

const pushCalls = (calls: { url: string }[]) => calls.filter((c) => c.url.includes('exp.host'));

describe('crosses', () => {
  it('trips at or past the target in the chosen direction', () => {
    assert.equal(crosses('below', 73000, 72999.99), true);
    assert.equal(crosses('below', 73000, 73000), true);
    assert.equal(crosses('below', 73000, 73000.01), false);
    assert.equal(crosses('above', 80, 80), true);
    assert.equal(crosses('above', 80, 79.99), false);
  });
});

describe('parseSyncBody', () => {
  it('accepts a well-formed body', () => {
    const parsed = parseSyncBody({ token: TOKEN_A, tripwires: [wire()] });
    assert.equal(parsed?.wires[0].coinId, 'bitcoin');
  });
  it('rejects bad tokens, directions, numbers and oversized lists', () => {
    assert.equal(parseSyncBody({ token: 'nope', tripwires: [] }), null);
    assert.equal(parseSyncBody({ token: TOKEN_A, tripwires: [wire({ direction: 'sideways' })] }), null);
    assert.equal(parseSyncBody({ token: TOKEN_A, tripwires: [wire({ target: -1 })] }), null);
    assert.equal(parseSyncBody({ token: TOKEN_A, tripwires: [wire({ coinId: 'BTC; DROP TABLE' })] }), null);
    const many = Array.from({ length: 51 }, (_, i) => wire({ id: `w${i}` }));
    assert.equal(parseSyncBody({ token: TOKEN_A, tripwires: many }), null);
  });
});

describe('syncDevice', () => {
  it('adds, is idempotent, and removes what the app dropped', async () => {
    const { db, rows } = fakeD1();
    await syncDevice(db, TOKEN_A, [wire({ id: 'a' }), wire({ id: 'b' })] as any);
    await syncDevice(db, TOKEN_A, [wire({ id: 'a' }), wire({ id: 'b' })] as any);
    assert.equal(rows('SELECT * FROM tripwires').length, 2);
    await syncDevice(db, TOKEN_A, [wire({ id: 'a' })] as any);
    assert.deepEqual(rows('SELECT id FROM tripwires').map((r) => r.id), ['a']);
    await syncDevice(db, TOKEN_A, []);
    assert.equal(rows('SELECT * FROM tripwires').length, 0);
  });

  it('never un-trips a wire, and adopts trips from either side', async () => {
    const { db, rows } = fakeD1();
    await syncDevice(db, TOKEN_A, [wire({ id: 'a' }), wire({ id: 'b' })] as any);
    rows("UPDATE tripwires SET status='tripped', tripped_at=5, tripped_price=72000 WHERE id='a'");
    const back = await syncDevice(db, TOKEN_A, [wire({ id: 'a' }), wire({ id: 'b', status: 'tripped', trippedAt: 9, trippedPrice: 71000 })] as any);
    const byId = Object.fromEntries(back.map((w: any) => [w.id, w]));
    assert.equal(byId.a.status, 'tripped');
    assert.equal(byId.a.trippedPrice, 72000);
    assert.equal(byId.b.status, 'tripped');
    assert.equal(byId.b.trippedPrice, 71000);
  });

  it('does not let another device take over an existing id', async () => {
    const { db, rows } = fakeD1();
    await syncDevice(db, TOKEN_A, [wire({ id: 'a' })] as any);
    await syncDevice(db, TOKEN_B, [wire({ id: 'a', status: 'tripped', trippedAt: 1, trippedPrice: 1 })] as any);
    const [row] = rows('SELECT token, status FROM tripwires WHERE id = ?', 'a');
    assert.equal(row.token, TOKEN_A);
    assert.equal(row.status, 'armed');
  });
});

describe('runTick', () => {
  it('does nothing, and calls nothing, when nothing is armed', async () => {
    const { db } = fakeD1();
    const net = mockFetch({});
    assert.deepEqual(await runTick({ db, fetchFn: net.fn }), { armed: 0, hits: 0, delivered: 0 });
    assert.equal(net.calls.length, 0);
  });

  it('prices each coin once and stays quiet while no wire has crossed', async () => {
    const { db } = fakeD1();
    await syncDevice(db, TOKEN_A, [wire({ id: 'a' }), wire({ id: 'b', target: 70000 })] as any);
    const net = mockFetch({ prices: { bitcoin: 73412.5 } });
    const result = await runTick({ db, fetchFn: net.fn });
    assert.deepEqual(result, { armed: 2, hits: 0, delivered: 0 });
    assert.equal(net.calls.filter((c) => c.url.includes('coingecko')).length, 1);
    assert.equal(pushCalls(net.calls).length, 0);
  });

  it('pushes a crossed wire once, then marks it tripped', async () => {
    const { db, rows } = fakeD1();
    await syncDevice(db, TOKEN_A, [wire({ id: 'a' })] as any);
    const net = mockFetch({ prices: { bitcoin: 72988.12 } });
    const result = await runTick({ db, fetchFn: net.fn, now: () => 1_700_000_999_000 });
    assert.deepEqual(result, { armed: 1, hits: 1, delivered: 1 });

    const [message] = pushCalls(net.calls)[0].body;
    assert.equal(message.to, TOKEN_A);
    assert.equal(message.title, 'BTC fell below $73,000');
    assert.equal(message.body, 'Bitcoin is now $72,988.12. Your tripwire fired.');
    assert.equal(message.priority, 'high');
    assert.deepEqual(message.data, { tripwireId: 'a' });

    const [row] = rows('SELECT status, tripped_at, tripped_price FROM tripwires');
    assert.deepEqual({ ...row }, { status: 'tripped', tripped_at: 1_700_000_999_000, tripped_price: 72988.12 });

    const again = mockFetch({ prices: { bitcoin: 72000 } });
    await runTick({ db, fetchFn: again.fn });
    assert.equal(again.calls.length, 0, 'a tripped wire is never pushed twice');
  });

  it('handles rises above a target', async () => {
    const { db } = fakeD1();
    await syncDevice(db, TOKEN_A, [wire({ id: 'a', coinId: 'solana', symbol: 'SOL', name: 'Solana', direction: 'above', target: 150, startPrice: 142.77 })] as any);
    const net = mockFetch({ prices: { solana: 151.2 } });
    await runTick({ db, fetchFn: net.fn });
    assert.equal(pushCalls(net.calls)[0].body[0].title, 'SOL rose above $150');
  });

  it('leaves a wire armed when the push fails, and retries on the next tick', async () => {
    const { db, rows } = fakeD1();
    await syncDevice(db, TOKEN_A, [wire({ id: 'a' })] as any);
    const down = mockFetch({ prices: { bitcoin: 72000 }, push: () => new Response('boom', { status: 503 }) });
    assert.equal((await runTick({ db, fetchFn: down.fn })).delivered, 0);
    assert.equal(rows('SELECT status FROM tripwires')[0].status, 'armed');

    const up = mockFetch({ prices: { bitcoin: 72000 } });
    assert.equal((await runTick({ db, fetchFn: up.fn })).delivered, 1);
    assert.equal(rows('SELECT status FROM tripwires')[0].status, 'tripped');
  });

  it('forgets a device Expo reports as unregistered', async () => {
    const { db, rows } = fakeD1();
    await syncDevice(db, TOKEN_A, [wire({ id: 'a' })] as any);
    await syncDevice(db, TOKEN_B, [wire({ id: 'b' })] as any);
    const net = mockFetch({
      prices: { bitcoin: 72000 },
      push: (messages) =>
        new Response(
          JSON.stringify({
            data: messages.map((m) =>
              m.to === TOKEN_A
                ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }
                : { status: 'ok', id: 't' },
            ),
          }),
        ),
    });
    await runTick({ db, fetchFn: net.fn });
    const left = rows('SELECT id, status FROM tripwires');
    assert.deepEqual(left.map((r) => ({ ...r })), [{ id: 'b', status: 'tripped' }]);
  });

  it('skips coins the price feed did not return', async () => {
    const { db } = fakeD1();
    await syncDevice(db, TOKEN_A, [wire({ id: 'a' })] as any);
    const net = mockFetch({ prices: {} });
    assert.deepEqual(await runTick({ db, fetchFn: net.fn }), { armed: 1, hits: 0, delivered: 0 });
  });

  it('surfaces a price-feed outage so the scheduler logs it', async () => {
    const { db } = fakeD1();
    await syncDevice(db, TOKEN_A, [wire({ id: 'a' })] as any);
    await assert.rejects(runTick({ db, fetchFn: mockFetch({ geckoStatus: 429 }).fn }), /429/);
  });
});

describe('sendPushes', () => {
  it('splits into batches of 100', async () => {
    const messages = Array.from({ length: 250 }, (_, i) => toMessage({ id: `w${i}`, token: TOKEN_A, coin_id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', direction: 'below', target: 1, start_price: 2, created_at: 0, status: 'armed', tripped_at: null, tripped_price: null }, 0.5));
    const net = mockFetch({});
    const outcomes = await sendPushes(messages, net.fn);
    assert.deepEqual(pushCalls(net.calls).map((c) => c.body.length), [100, 100, 50]);
    assert.ok(outcomes.every((o) => o === 'ok'));
  });
});

describe('fetchPrices', () => {
  it('sends the Demo key only when there is one', async () => {
    const seen: (HeadersInit | undefined)[] = [];
    const fn = (async (_url: unknown, init?: { headers?: HeadersInit }) => {
      seen.push(init?.headers);
      return new Response('{}');
    }) as unknown as typeof fetch;
    await fetchPrices(['bitcoin'], fn);
    await fetchPrices(['bitcoin'], fn, 'CG-demo');
    assert.equal((seen[0] as Record<string, string>)['x-cg-demo-api-key'], undefined);
    assert.equal((seen[1] as Record<string, string>)['x-cg-demo-api-key'], 'CG-demo');
  });
});
