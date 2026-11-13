import type { Direction } from './types';

/** A price trips a wire when it reaches the target or goes past it, in the wire's direction. */
export const crosses = (direction: Direction, target: number, price: number): boolean =>
  direction === 'below' ? price <= target : price >= target;
