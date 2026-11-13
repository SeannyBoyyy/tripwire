import {
  isPushToken,
  parseSyncBody,
  runTick,
  sendTestPush,
  syncDevice,
} from './core.ts';

interface Env {
  DB: D1Database;
  /** Shared secret the app sends in `x-tripwire-key`. Set with `wrangler secret put API_KEY`. */
  API_KEY?: string;
  /** Optional CoinGecko Demo key. Set with `wrangler secret put COINGECKO_KEY`. */
  COINGECKO_KEY?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === 'GET' && pathname === '/') return new Response('tripwire ok');
    if (request.method !== 'POST') return json({ error: 'not found' }, 404);

    if (!env.API_KEY) return json({ error: 'API_KEY is not set on the server' }, 503);
    if (!safeEqual(request.headers.get('x-tripwire-key') ?? '', env.API_KEY)) {
      return json({ error: 'unauthorized' }, 401);
    }

    const raw = await request.text();
    if (raw.length > 64_000) return json({ error: 'request too large' }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'invalid json' }, 400);
    }

    if (pathname === '/v1/sync') {
      const parsed = parseSyncBody(body);
      if (!parsed) return json({ error: 'invalid body' }, 400);
      return json({ tripwires: await syncDevice(env.DB, parsed.token, parsed.wires) });
    }

    if (pathname === '/v1/test') {
      const { token, delaySeconds } = (body ?? {}) as { token?: unknown; delaySeconds?: unknown };
      if (!isPushToken(token)) return json({ error: 'invalid token' }, 400);
      // A short delay leaves time to fully close the app before the push lands.
      const delay = typeof delaySeconds === 'number' ? Math.min(Math.max(delaySeconds, 0), 20) : 0;
      if (delay > 0) {
        ctx.waitUntil(
          sleep(delay * 1000)
            .then(() => sendTestPush(token, fetch))
            .then(
              (delivery) => console.log(JSON.stringify({ test: delivery })),
              (error: unknown) => console.error('test push failed', String(error)),
            ),
        );
        return json({ scheduledIn: delay });
      }
      return json({ delivery: await sendTestPush(token, fetch) });
    }

    return json({ error: 'not found' }, 404);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runTick({ db: env.DB, fetchFn: fetch, coingeckoKey: env.COINGECKO_KEY }).then(
        (result) => console.log(JSON.stringify(result)),
        (error: unknown) => console.error('tick failed', String(error)),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
