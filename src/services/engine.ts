import { notifyTripped } from './notify';
import { updateTripwires } from './storage';
import { crosses } from '../domain/rules';
import type { PriceMap, Tripwire } from '../domain/types';

/**
 * Trips every armed wire the given prices have crossed, persists that, then
 * fires one local notification per wire. Safe to call from the foreground
 * poller and from the background task: a wire only ever trips once.
 */
export async function evaluateTripwires(prices: PriceMap): Promise<Tripwire[]> {
  const fired: { wire: Tripwire; price: number }[] = [];

  await updateTripwires((list) =>
    list.map((t) => {
      const price = prices[t.coinId];
      if (t.status !== 'armed' || price === undefined || !crosses(t.direction, t.target, price)) {
        return t;
      }
      const wire: Tripwire = { ...t, status: 'tripped', trippedAt: Date.now(), trippedPrice: price };
      fired.push({ wire, price });
      return wire;
    }),
  );

  await Promise.allSettled(fired.map((f) => notifyTripped(f.wire, f.price)));
  return fired.map((f) => f.wire);
}
