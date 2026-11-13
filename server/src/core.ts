// Everything with side effects (database, network, clock) is injected, so the
// logic below runs unchanged in the Worker and in the Node tests.

export type Direction = 'below' | 'above';
export type Status = 'armed' | 'tripped';

/** A tripwire as the app sends it. */
export interface WireIn {
  id: string;
  coinId: string;
  symbol: string;
  name: string;
  direction: Direction;
  target: number;
  startPrice: number;
  createdAt: number;
  status: Status;
  trippedAt: number | null;
  trippedPrice: number | null;
}

export interface WireRow {
  id: string;
  token: string;
  coin_id: string;
  symbol: string;
  name: string;
  direction: Direction;
  target: number;
  start_price: number;
  created_at: number;
  status: Status;
  tripped_at: number | null;
  tripped_price: number | null;
}

/** What the app gets back so it can adopt trips that fired while it was closed. */
export interface ServerWire {
  id: string;
  status: Status;
  trippedAt: number | null;
  trippedPrice: number | null;
}

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  priority: 'high';
  channelId: string;
  ttl: number;
  data: Record<string, unknown>;
}

/** ok: accepted by Expo. dead: the device is gone. retry: try again next tick. */
export type Delivery = 'ok' | 'dead' | 'retry';

export const MAX_WIRES = 50;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PUSH_TTL_SECONDS = 6 * 60 * 60;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const COINGECKO = 'https://api.coingecko.com/api/v3';

export const crosses = (direction: Direction, target: number, price: number): boolean =>
  direction === 'below' ? price <= target : price >= target;

// ---------------------------------------------------------------- validation

const TOKEN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{10,64}\]$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const COIN_ID = /^[a-z0-9._-]{1,64}$/;

const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseWire(value: unknown): WireIn | null {
  if (typeof value !== 'object' || value === null) return null;
  const w = value as Record<string, unknown>;
  if (typeof w.id !== 'string' || !SAFE_ID.test(w.id)) return null;
  if (typeof w.coinId !== 'string' || !COIN_ID.test(w.coinId)) return null;
  if (!text(w.symbol, 16) || !text(w.name, 64)) return null;
  if (w.direction !== 'below' && w.direction !== 'above') return null;
  if (w.status !== 'armed' && w.status !== 'tripped') return null;
  if (!positive(w.target) || !positive(w.startPrice) || !finite(w.createdAt)) return null;
  return {
    id: w.id,
    coinId: w.coinId,
    symbol: w.symbol,
    name: w.name,
    direction: w.direction,
    target: w.target,
    startPrice: w.startPrice,
    createdAt: w.createdAt,
    status: w.status,
    trippedAt: finite(w.trippedAt) ? w.trippedAt : null,
    trippedPrice: positive(w.trippedPrice) ? w.trippedPrice : null,
  };
}

export function isPushToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

export function parseSyncBody(body: unknown): { token: string; wires: WireIn[] } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { token, tripwires } = body as Record<string, unknown>;
  if (!isPushToken(token) || !Array.isArray(tripwires) || tripwires.length > MAX_WIRES) return null;
  const wires: WireIn[] = [];
  for (const raw of tripwires) {
    const wire = parseWire(raw);
    if (!wire) return null;
    wires.push(wire);
  }
  return { token, wires };
}

// ---------------------------------------------------------------- formatting

const places = (n: number) => (n >= 1 ? 2 : n >= 0.01 ? 4 : n >= 0.0001 ? 6 : 8);
export const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: places(n), maximumFractionDigits: places(n) })}`;
export const plain = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: places(n) });

export function toMessage(row: WireRow, price: number): PushMessage {
  const verb = row.direction === 'below' ? 'fell below' : 'rose above';
  return {
    to: row.token,
    title: `${row.symbol} ${verb} $${plain(row.target)}`,
    body: `${row.name} is now ${usd(price)}. Your tripwire fired.`,
    sound: 'default',
    priority: 'high',
    channelId: 'tripwires',
    ttl: PUSH_TTL_SECONDS,
    data: { tripwireId: row.id },
  };
}

// ------------------------------------------------------------------- network

export async function fetchPrices(
  ids: string[],
  fetchFn: typeof fetch,
  demoKey?: string,
): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  const res = await fetchFn(`${COINGECKO}/simple/price?ids=${ids.join(',')}&vs_currencies=usd`, {
    headers: { accept: 'application/json', ...(demoKey ? { 'x-cg-demo-api-key': demoKey } : {}) },
  });
  if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);
  const data = (await res.json()) as Record<string, { usd?: number }>;
  const prices: Record<string, number> = {};
  for (const id of ids) {
    const price = data[id]?.usd;
    if (typeof price === 'number') prices[id] = price;
  }
  return prices;
}

/** Sends in batches of 100 (Expo's per-request limit). Anything that isn't a clear success is retried next tick. */
export async function sendPushes(messages: PushMessage[], fetchFn: typeof fetch): Promise<Delivery[]> {
  const outcomes: Delivery[] = messages.map(() => 'retry');
  for (let start = 0; start < messages.length; start += 100) {
    const batch = messages.slice(start, start + 100);
    try {
      const res = await fetchFn(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(batch),
      });
      if (!res.ok) continue;
      const { data } = (await res.json()) as {
        data?: { status: string; details?: { error?: string } }[];
      };
      batch.forEach((_, i) => {
        const ticket = data?.[i];
        outcomes[start + i] =
          ticket?.status === 'ok' ? 'ok' : ticket?.details?.error === 'DeviceNotRegistered' ? 'dead' : 'retry';
      });
    } catch {
      // network error: leave this batch as 'retry'
    }
  }
  return outcomes;
}

export async function sendTestPush(token: string, fetchFn: typeof fetch): Promise<Delivery> {
  const [outcome] = await sendPushes(
    [
      {
        to: token,
        title: 'Tripwire test',
        body: 'Your server can reach this phone, even with the app closed.',
        sound: 'default',
        priority: 'high',
        channelId: 'tripwires',
        ttl: 300,
        data: { test: true },
      },
    ],
    fetchFn,
  );
  return outcome;
}

// ------------------------------------------------------------------ database

/**
 * Makes the server's copy of one device match the app's: wires the app no
 * longer has are removed, new ones are added, and a trip is never undone from
 * either side. Everything runs as one batch, so it applies fully or not at all.
 */
export async function syncDevice(db: D1Database, token: string, wires: WireIn[]): Promise<ServerWire[]> {
  const ids = wires.map((w) => w.id);
  const statements: D1PreparedStatement[] = [
    ids.length === 0
      ? db.prepare('DELETE FROM tripwires WHERE token = ?').bind(token)
      : db
          .prepare(`DELETE FROM tripwires WHERE token = ? AND id NOT IN (${ids.map(() => '?').join(',')})`)
          .bind(token, ...ids),
  ];

  for (const w of wires) {
    statements.push(
      db
        .prepare(
          `INSERT INTO tripwires
             (id, token, coin_id, symbol, name, direction, target, start_price, created_at, status, tripped_at, tripped_price)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             status = CASE WHEN tripwires.status = 'tripped' OR excluded.status = 'tripped' THEN 'tripped' ELSE 'armed' END,
             tripped_at = COALESCE(tripwires.tripped_at, excluded.tripped_at),
             tripped_price = COALESCE(tripwires.tripped_price, excluded.tripped_price)
           WHERE tripwires.token = excluded.token`,
        )
        .bind(
          w.id,
          token,
          w.coinId,
          w.symbol,
          w.name,
          w.direction,
          w.target,
          w.startPrice,
          w.createdAt,
          w.status,
          w.trippedAt,
          w.trippedPrice,
        ),
    );
  }
  await db.batch(statements);

  const { results } = await db
    .prepare(
      'SELECT id, status, tripped_at AS trippedAt, tripped_price AS trippedPrice FROM tripwires WHERE token = ?',
    )
    .bind(token)
    .all<ServerWire>();
  return results;
}

export interface TickDeps {
  db: D1Database;
  fetchFn: typeof fetch;
  coingeckoKey?: string;
  now?: () => number;
}

export interface TickResult {
  armed: number;
  hits: number;
  delivered: number;
}

/**
 * One scheduled check: price every coin with an armed wire, push the ones that
 * crossed, and only then mark them tripped. A failed push leaves the wire armed
 * so the next tick retries (at-least-once; a rare duplicate beats a lost alert).
 */
export async function runTick(deps: TickDeps): Promise<TickResult> {
  const { db, fetchFn } = deps;
  const now = (deps.now ?? Date.now)();

  const { results: armed } = await db
    .prepare("SELECT * FROM tripwires WHERE status = 'armed' LIMIT 500")
    .all<WireRow>();
  if (armed.length === 0) return { armed: 0, hits: 0, delivered: 0 };

  const prices = await fetchPrices([...new Set(armed.map((r) => r.coin_id))], fetchFn, deps.coingeckoKey);
  const hits = armed.filter((r) => {
    const price = prices[r.coin_id];
    return price !== undefined && crosses(r.direction, r.target, price);
  });
  if (hits.length === 0) return { armed: armed.length, hits: 0, delivered: 0 };

  const outcomes = await sendPushes(
    hits.map((r) => toMessage(r, prices[r.coin_id])),
    fetchFn,
  );

  let delivered = 0;
  const statements: D1PreparedStatement[] = [];
  hits.forEach((r, i) => {
    if (outcomes[i] === 'ok') {
      delivered += 1;
      statements.push(
        db
          .prepare("UPDATE tripwires SET status = 'tripped', tripped_at = ?, tripped_price = ? WHERE id = ? AND status = 'armed'")
          .bind(now, prices[r.coin_id], r.id),
      );
    } else if (outcomes[i] === 'dead') {
      statements.push(db.prepare('DELETE FROM tripwires WHERE token = ?').bind(r.token));
    }
  });
  statements.push(
    db.prepare("DELETE FROM tripwires WHERE status = 'tripped' AND tripped_at < ?").bind(now - RETENTION_MS),
  );
  await db.batch(statements);

  return { armed: armed.length, hits: hits.length, delivered };
}
