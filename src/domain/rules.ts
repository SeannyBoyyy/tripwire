import type { Direction } from './types';

/** A price trips a wire when it reaches the target or goes past it, in the wire's direction. */
export const crosses = (direction: Direction, target: number, price: number): boolean =>
  direction === 'below' ? price <= target : price >= target;

/** The most wires the server takes in one sync. Keep in step with MAX_WIRES in server/src/core.ts. */
export const SYNC_LIMIT = 50;

/** Armed wires allowed at once. Fewer than SYNC_LIMIT, so every sync has room for the newest trips. */
export const MAX_ARMED = 40;
