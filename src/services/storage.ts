import AsyncStorage from '@react-native-async-storage/async-storage';
import { readList } from '../domain/persist';
import type { Tripwire } from '../domain/types';

const KEY = 'tripwire.items.v1';

/** Throws StorageReadError when the saved list can't be read; see readList. */
export const loadTripwires = (): Promise<Tripwire[]> => readList(AsyncStorage, KEY);

// Read-modify-write goes through one queue so the UI, the price poller and the
// background task can't overwrite each other's changes within a JS runtime.
let queue: Promise<unknown> = Promise.resolve();

/** Rejects, and writes nothing, when the saved list can't be read. */
export function updateTripwires(change: (list: Tripwire[]) => Tripwire[]): Promise<Tripwire[]> {
  const run = queue.then(async () => {
    const next = change(await loadTripwires());
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}
