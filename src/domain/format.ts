function decimals(n: number): number {
  return n >= 1 ? 2 : n >= 0.01 ? 4 : n >= 0.0001 ? 6 : 8;
}

/** $73,412.50 — adaptive precision so sub-dollar coins stay readable. */
export function fmtPrice(n: number): string {
  const d = decimals(n);
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

/** 73,000 — a target without trailing zeros or a currency sign. */
export function fmtTarget(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: decimals(n) });
}

export const arrow = (change: number) => (change >= 0 ? '▲' : '▼');
export const fmtPct = (n: number) => `${Math.abs(n).toFixed(2)}%`;

export function fmtWhen(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

/** "73,000" or "73000.5" → 73000.5. Returns null for anything that isn't a positive number. */
export function parseTarget(text: string): number | null {
  const n = Number.parseFloat(text.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Plain digits for a text input; never scientific notation. */
export function toInput(n: number): string {
  return n.toFixed(8).replace(/\.?0+$/, '');
}

/** Snap to a human price step so quick picks read 71,200 rather than 71,212.46. */
export function roundNice(n: number): number {
  const step =
    n >= 10_000 ? 100 : n >= 1_000 ? 10 : n >= 100 ? 1 : n >= 1 ? 0.01 : n >= 0.01 ? 0.0001 : 0.000001;
  return Number((Math.round(n / step) * step).toFixed(8));
}

export type KeyId = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back' | 'clear';

/** Applies one keypad press to the raw amount string ("73000.5"). */
export function applyKey(raw: string, key: KeyId): string {
  if (key === 'clear') return '';
  if (key === 'back') return raw.slice(0, -1);
  if (key === '.') return raw.includes('.') ? raw : `${raw || '0'}.`;
  const [whole, fraction] = raw.split('.');
  if (fraction !== undefined ? fraction.length >= 8 : whole.length >= 9) return raw;
  return raw === '0' ? key : raw + key; // no leading zeros
}

/** "73000.5" -> "73,000.5", keeping a trailing "." while the user is mid-entry. */
export function groupDigits(raw: string): string {
  const [whole, fraction] = raw.split('.');
  const grouped = (whole || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}
