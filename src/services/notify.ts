import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { fmtPrice, fmtTarget } from '../domain/format';
import type { Tripwire } from '../domain/types';

const CHANNEL = 'tripwires';

// Show the banner and sound even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function prepareChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Price tripwires',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 200, 120, 200],
    lightColor: '#F7B500',
  });
}

export async function notificationsAllowed(): Promise<boolean> {
  return (await Notifications.getPermissionsAsync()).granted;
}

export async function requestNotifications(): Promise<boolean> {
  await prepareChannel(); // Android 13+ only shows the prompt once a channel exists
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

// `null` fires immediately; on Android the channel decides sound and priority.
const NOW = Platform.OS === 'android' ? { channelId: CHANNEL } : null;

export function notifyTripped(t: Tripwire, price: number): Promise<string> {
  const verb = t.direction === 'below' ? 'fell below' : 'rose above';
  return Notifications.scheduleNotificationAsync({
    identifier: t.id, // a repeat for the same wire replaces the banner instead of stacking
    content: {
      title: `${t.symbol} ${verb} $${fmtTarget(t.target)}`,
      body: `${t.name} is now ${fmtPrice(price)}. Your tripwire fired.`,
      data: { tripwireId: t.id },
    },
    trigger: NOW,
  });
}

export function notifyTest(): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Tripwire test',
      body: 'If you can read this, alerts will reach you.',
    },
    trigger: NOW,
  });
}

export function onNotificationTap(handler: () => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener(handler);
  return () => sub.remove();
}

export function onNotificationReceived(handler: () => void): () => void {
  const sub = Notifications.addNotificationReceivedListener(handler);
  return () => sub.remove();
}

export type PushToken = { ok: true; token: string } | { ok: false; reason: 'no-project' | 'failed' };

let cachedToken: string | null = null;

/**
 * This device's Expo push token. It needs an EAS project ID, which
 * `npx eas-cli init` writes into app.json. Cached for the session so the
 * minute-by-minute sync doesn't call Expo every time.
 */
export async function getPushToken(): Promise<PushToken> {
  if (cachedToken) return { ok: true, token: cachedToken };
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (typeof projectId !== 'string' || projectId.length === 0) return { ok: false, reason: 'no-project' };
  try {
    cachedToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    return { ok: true, token: cachedToken };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
