import type { Tripwire } from './types';

/** The saved list could not be read. That is not the same as an empty list, so nothing may be saved over it. */
export class StorageReadError extends Error {
  constructor() {
    super('The saved tripwires could not be read.');
    this.name = 'StorageReadError';
  }
}

/** The two storage calls we use, so the logic below runs on plain Node. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * Reads the saved list. Nothing saved yet is an empty list. A read that fails throws, so a
 * hiccup can never look like "no tripwires" and get saved over, or synced to the server as a
 * delete. A value that is there but isn't a list is copied aside first, then read as empty so
 * the app doesn't stay stuck on it.
 */
export async function readList(store: KeyValueStore, key: string): Promise<Tripwire[]> {
  let raw: string | null;
  try {
    raw = await store.getItem(key);
  } catch {
    throw new StorageReadError();
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as Tripwire[];
  } catch {
    // Not JSON at all: handled the same way as JSON that isn't a list.
  }
  await store.setItem(`${key}.unreadable`, raw).catch(() => undefined);
  return [];
}
