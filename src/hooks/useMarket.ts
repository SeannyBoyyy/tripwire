import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { fetchMarkets } from '../services/api';
import type { Coin, PriceMap } from '../domain/types';

export type MarketStatus = 'loading' | 'live' | 'stale' | 'error';

/** Foreground poll interval. CoinGecko's free tiers are rate limited; keep this at a minute or more. */
export const POLL_MS = 60_000;

export function useMarket(onPrices: (prices: PriceMap) => void) {
  const [coins, setCoins] = useState<Coin[]>([]);
  const [status, setStatus] = useState<MarketStatus>('loading');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const latest = useRef<Coin[]>([]);
  const onPricesRef = useRef(onPrices);
  useEffect(() => {
    onPricesRef.current = onPrices;
  }, [onPrices]);

  const load = useCallback(async (withSparkline: boolean) => {
    try {
      const fresh = await fetchMarkets(withSparkline || latest.current.length === 0);
      // Polls skip sparklines to save data, so carry the old ones forward.
      const sparks = new Map(latest.current.map((c) => [c.id, c.spark]));
      const next = fresh.map((c) => (c.spark.length > 0 ? c : { ...c, spark: sparks.get(c.id) ?? [] }));
      latest.current = next;
      setCoins(next);
      setUpdatedAt(Date.now());
      setStatus('live');
      onPricesRef.current(Object.fromEntries(next.map((c) => [c.id, c.price])));
    } catch {
      setStatus(latest.current.length > 0 ? 'stale' : 'error');
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      load(false);
      timer = setInterval(() => load(false), POLL_MS);
    };
    start();
    const sub = AppState.addEventListener('change', (state) => (state === 'active' ? start() : stop()));
    return () => {
      stop();
      sub.remove();
    };
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  return { coins, status, updatedAt, refreshing, refresh };
}
