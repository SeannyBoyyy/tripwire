import type { Coin, PriceMap } from '../domain/types';

const BASE = 'https://api.coingecko.com/api/v3';

// Optional free Demo key: https://www.coingecko.com/en/api (see .env.example).
const DEMO_KEY = process.env.EXPO_PUBLIC_COINGECKO_KEY;

// Stablecoins and wrapped/staked copies of other coins make pointless tripwires.
const SKIP = /usd|tether|wrapped|staked|bridged|\bpeg|^w(eth|btc|eeth|steth)$/i;

async function getJson<T>(path: string, timeoutMs = 12_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      signal: ctrl.signal,
      headers: {
        accept: 'application/json',
        ...(DEMO_KEY ? { 'x-cg-demo-api-key': DEMO_KEY } : {}),
      },
    });
    if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface MarketRow {
  id: string;
  symbol: string;
  name: string;
  current_price: number | null;
  price_change_percentage_24h: number | null;
  sparkline_in_7d?: { price: number[] };
}

const thin = (series: number[], every: number) => series.filter((_, i) => i % every === 0);

/**
 * Top coins by market cap (ex-stables). Sparklines are ~10x the payload, so
 * the poller only asks for them on first load and on pull-to-refresh.
 */
export async function fetchMarkets(withSparkline: boolean, limit = 20): Promise<Coin[]> {
  const rows = await getJson<MarketRow[]>(
    `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=${withSparkline}&price_change_percentage=24h`,
  );
  return rows
    .filter((r) => r.current_price != null && !SKIP.test(r.name) && !SKIP.test(r.symbol))
    .slice(0, limit)
    .map((r, i) => ({
      id: r.id,
      symbol: r.symbol.toUpperCase(),
      name: r.name,
      rank: i + 1,
      price: r.current_price as number,
      change24h: r.price_change_percentage_24h ?? 0,
      spark: thin(r.sparkline_in_7d?.price ?? [], 2),
    }));
}

/** Lightweight price lookup for the background task. */
export async function fetchPrices(ids: string[]): Promise<PriceMap> {
  const data = await getJson<Record<string, { usd?: number }>>(
    `/simple/price?ids=${ids.join(',')}&vs_currencies=usd`,
  );
  const out: PriceMap = {};
  for (const id of ids) {
    const price = data[id]?.usd;
    if (typeof price === 'number') out[id] = price;
  }
  return out;
}
