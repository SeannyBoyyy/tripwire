export type Direction = 'below' | 'above';

export interface Coin {
  id: string; // CoinGecko id, e.g. "bitcoin"
  symbol: string; // "BTC"
  name: string;
  rank: number;
  price: number; // USD
  change24h: number; // percent
  spark: number[]; // roughly 7 days of prices, oldest first
}

export interface Tripwire {
  id: string;
  coinId: string;
  symbol: string;
  name: string;
  direction: Direction;
  target: number; // USD
  startPrice: number; // price when armed; drives the progress rule
  createdAt: number;
  status: 'armed' | 'tripped';
  trippedAt?: number;
  trippedPrice?: number;
}

export type NewTripwire = Pick<
  Tripwire,
  'coinId' | 'symbol' | 'name' | 'direction' | 'target' | 'startPrice'
>;

export type PriceMap = Record<string, number>;

/** What the server reports back for one tripwire, so the app can adopt trips that fired while it was closed. */
export interface ServerWire {
  id: string;
  status: 'armed' | 'tripped';
  trippedAt: number | null;
  trippedPrice: number | null;
}
