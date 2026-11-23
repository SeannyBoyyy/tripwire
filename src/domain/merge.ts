import type { ServerWire, Tripwire } from './types';

/**
 * Marks local wires as tripped when the server already fired them while the
 * app was closed. Returns the same array when nothing changed, so callers can
 * skip a write with a simple identity check.
 */
export function applyServerTrips(local: Tripwire[], remote: ServerWire[]): Tripwire[] {
  const tripped = new Map(remote.filter((w) => w.status === 'tripped').map((w) => [w.id, w]));
  if (tripped.size === 0) return local;

  let changed = false;
  const next = local.map((t) => {
    const server = tripped.get(t.id);
    if (t.status !== 'armed' || !server) return t;
    changed = true;
    return {
      ...t,
      status: 'tripped' as const,
      trippedAt: server.trippedAt ?? Date.now(),
      trippedPrice: server.trippedPrice ?? t.target,
    };
  });
  return changed ? next : local;
}

/**
 * The wires to send the server: every armed one first, then the newest trips that still fit.
 * Older trips are left out, which is safe. A trip is final, and the server only needs the
 * recent ones so it never pushes a wire this phone already fired. Returns the same array when
 * everything fits.
 */
export function selectForSync(local: Tripwire[], limit: number): Tripwire[] {
  if (local.length <= limit) return local;
  const armed = local.filter((t) => t.status === 'armed');
  const tripped = local
    .filter((t) => t.status === 'tripped')
    .sort((a, b) => (b.trippedAt ?? 0) - (a.trippedAt ?? 0));
  return [...armed, ...tripped].slice(0, limit);
}
