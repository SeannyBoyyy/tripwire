import { applyServerTrips, selectForSync } from '../domain/merge';
import { SYNC_LIMIT } from '../domain/rules';
import { getPushToken, notificationsAllowed } from './notify';
import { loadTripwires, updateTripwires } from './storage';
import type { ServerWire } from '../domain/types';

// The server is optional. Without these two values Tripwire still works while it is open.
const API = process.env.EXPO_PUBLIC_TRIPWIRE_API?.replace(/\/+$/, '');
const KEY = process.env.EXPO_PUBLIC_TRIPWIRE_KEY;

export const serverConfigured = Boolean(API && KEY);

export type ServerState = 'off' | 'connecting' | 'connected' | 'needs-permission' | 'needs-project' | 'error';
export interface SyncResult {
  state: ServerState;
  /** True when the server told us about trips and local storage changed. */
  changed: boolean;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-tripwire-key': KEY ?? '' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function run(): Promise<SyncResult> {
  try {
    if (!(await notificationsAllowed())) return { state: 'needs-permission', changed: false };
    const push = await getPushToken();
    if (!push.ok) return { state: push.reason === 'no-project' ? 'needs-project' : 'error', changed: false };

    const local = await loadTripwires();
    const { tripwires } = await post<{ tripwires: ServerWire[] }>('/v1/sync', {
      token: push.token,
      // The server takes at most SYNC_LIMIT wires. Armed ones always go; only the oldest trips stay behind.
      tripwires: selectForSync(local, SYNC_LIMIT),
    });
    const changed = applyServerTrips(local, tripwires) !== local;
    if (changed) await updateTripwires((list) => applyServerTrips(list, tripwires));
    return { state: 'connected', changed };
  } catch {
    return { state: 'error', changed: false };
  }
}

let inFlight: Promise<SyncResult> | null = null;

/** Sends our wires to the server and adopts any trips it fired. Overlapping calls share one request. */
export function syncWithServer(): Promise<SyncResult> {
  if (!serverConfigured) return Promise.resolve({ state: 'off', changed: false });
  inFlight ??= run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export type TestSend = 'sent' | 'no-project' | 'no-token';

/** Asks the server to push a test alert to this phone, and says why when it can't. Throws if the server errors. */
export async function sendServerTest(delaySeconds: number): Promise<TestSend> {
  const push = await getPushToken();
  if (!push.ok) return push.reason === 'no-project' ? 'no-project' : 'no-token';
  await post('/v1/test', { token: push.token, delaySeconds });
  return 'sent';
}
