import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { fetchPrices } from './api';
import { evaluateTripwires } from './engine';
import { loadTripwires } from './storage';

export const TASK = 'tripwire-price-check';
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
export type BackgroundState = 'active' | 'idle' | 'unavailable';

type TaskManagerModule = typeof import('expo-task-manager');
type BackgroundTaskModule = typeof import('expo-background-task');

// Loaded defensively: a runtime without these native modules falls back to
// foreground-only checks instead of crashing at import time.
function loadNative(): { tm: TaskManagerModule; bt: BackgroundTaskModule } | null {
  if (Platform.OS === 'web') return null;
  try {
    return { tm: require('expo-task-manager'), bt: require('expo-background-task') };
  } catch {
    return null;
  }
}

const native = loadNative();

// Must run at module scope so the OS can wake the app headlessly and find the task.
if (native) {
  const { tm, bt } = native;
  tm.defineTask(TASK, async () => {
    try {
      const armed = (await loadTripwires()).filter((t) => t.status === 'armed');
      if (armed.length > 0) {
        const prices = await fetchPrices([...new Set(armed.map((t) => t.coinId))]);
        await evaluateTripwires(prices);
      }
      return bt.BackgroundTaskResult.Success;
    } catch {
      return bt.BackgroundTaskResult.Failed;
    }
  });
}

/** Keeps the OS-level job registered only while there is something armed to watch. */
export async function syncBackgroundCheck(hasArmed: boolean): Promise<BackgroundState> {
  if (!native) return 'unavailable';
  const { tm, bt } = native;
  try {
    const registered = await tm.isTaskRegisteredAsync(TASK);
    if (!hasArmed) {
      if (registered) await bt.unregisterTaskAsync(TASK);
      return 'idle';
    }
    if ((await bt.getStatusAsync()) !== bt.BackgroundTaskStatus.Available) return 'unavailable';
    if (!registered) await bt.registerTaskAsync(TASK, { minimumInterval: 15 });
    return 'active';
  } catch {
    return 'unavailable';
  }
}
