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
