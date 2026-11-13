import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Tripwire } from '../domain/types';

const KEY = 'tripwire.items.v1';

export async function loadTripwires(): Promise<Tripwire[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Tripwire[]) : [];
  } catch {
    return [];
  }
}

// Read-modify-write goes through one queue so the UI, the price poller and the
// background task can't overwrite each other's changes within a JS runtime.
let queue: Promise<unknown> = Promise.resolve();

export function updateTripwires(change: (list: Tripwire[]) => Tripwire[]): Promise<Tripwire[]> {
  const run = queue.then(async () => {
    const next = change(await loadTripwires());
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}
