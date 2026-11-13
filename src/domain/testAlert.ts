// The "send test alert" flow as a pure state machine plus the words shown for each state.
// No React Native in here, so every transition and every message is unit-tested on plain Node.

export type Via = 'local' | 'server';
export type FailureReason = 'permission' | 'no-project' | 'no-token' | 'server' | 'local';
export type Tone = 'neutral' | 'active' | 'good' | 'bad';

export type TestState =
  | { phase: 'idle' }
  | { phase: 'sending'; via: Via; startedAt: number }
  | { phase: 'waiting'; via: Via; startedAt: number; arrivesAt: number }
  | { phase: 'received'; via: Via; lateBySeconds: number; whileClosed: boolean }
  | { phase: 'missed'; via: Via }
  | { phase: 'failed'; reason: FailureReason; detail?: string };

export type TestEvent =
  | { type: 'press'; via: Via; at: number }
  | { type: 'scheduled'; arrivesAt: number }
  | { type: 'arrived'; at: number }
  | { type: 'found-presented' }
  | { type: 'tick'; now: number }
  | { type: 'failed'; reason: FailureReason; detail?: string }
  | { type: 'reset' };

/** How long the server waits before pushing, so there is time to close the app first. */
export const TEST_DELAY_S = 10;

const graceMs = (via: Via) => (via === 'server' ? 20_000 : 5_000);

export function reduce(state: TestState, event: TestEvent): TestState {
  switch (event.type) {
    case 'press':
      // One test at a time; every other state may start a new one.
      return state.phase === 'sending' || state.phase === 'waiting'
        ? state
        : { phase: 'sending', via: event.via, startedAt: event.at };

    case 'scheduled':
      return state.phase === 'sending'
        ? { phase: 'waiting', via: state.via, startedAt: state.startedAt, arrivesAt: event.arrivesAt }
        : state;

    case 'arrived':
      // A local alert can land before its scheduling call has even returned, hence 'sending' too.
      if (state.phase === 'sending') {
        return { phase: 'received', via: state.via, lateBySeconds: 0, whileClosed: false };
      }
      if (state.phase === 'waiting') {
        const late = Math.max(0, (event.at - state.arrivesAt) / 1000);
        return { phase: 'received', via: state.via, lateBySeconds: late, whileClosed: false };
      }
      return state;

    case 'found-presented':
      // Back in the app and the test banner is still in Notification Center: it arrived while we were away.
      return state.phase === 'waiting' || state.phase === 'missed'
        ? { phase: 'received', via: state.via, lateBySeconds: 0, whileClosed: true }
        : state;

    case 'tick':
      return state.phase === 'waiting' && event.now > state.arrivesAt + graceMs(state.via)
        ? { phase: 'missed', via: state.via }
        : state;

    case 'failed':
      return state.phase === 'sending'
        ? { phase: 'failed', reason: event.reason, detail: event.detail }
        : state;

    case 'reset':
      return { phase: 'idle' };
  }
}

export interface TestView {
  label: string;
  note: string;
  tips: string[];
  tone: Tone;
  /** The button can't be pressed while a test is running. */
  busy: boolean;
  /** 0..1 while a server test counts down. */
  progress?: number;
  action?: 'open-settings';
}

export interface ViewContext {
  serverConfigured: boolean;
  serverConnected: boolean;
  now: number;
}

const FOCUS_TIP = 'Focus or Do Not Disturb is off.';
const PERMISSION_TIP = 'Notifications are allowed for this app in Settings.';
const WRANGLER_TIP = 'Run npx wrangler tail in server/ and tap again to see what the Worker did.';

function failureNote(reason: FailureReason, detail?: string): string {
  switch (reason) {
    case 'permission':
      return 'Notifications are off for this app, so nothing can be shown.';
    case 'no-project':
      return 'This project has no EAS ID yet. Run npx eas-cli init, then restart Expo.';
    case 'no-token':
      return 'Expo didn’t give this phone a push token. Check your connection and try again.';
    case 'server':
      return detail
        ? `Your server didn’t accept it (${detail}). Check the URL and key in .env.`
        : 'Your server didn’t answer. Check the URL and key in .env.';
    case 'local':
      return 'This phone couldn’t post the notification.';
  }
}

export function view(state: TestState, ctx: ViewContext): TestView {
  switch (state.phase) {
    case 'idle':
      return {
        label: 'SEND TEST ALERT',
        note: ctx.serverConnected
          ? `Your server sends it after ${TEST_DELAY_S} seconds, so you can close the app first and prove closed-app alerts work.`
          : ctx.serverConfigured
            ? 'Fires on this phone right now. Your server isn’t connected, so this only tests local alerts.'
            : 'Fires on this phone right now.',
        tips: [],
        tone: 'neutral',
        busy: false,
      };

    case 'sending':
      return { label: 'SENDING…', note: '', tips: [], tone: 'active', busy: true };

    case 'waiting': {
      if (state.via === 'local') return { label: 'WAITING…', note: '', tips: [], tone: 'active', busy: true };
      const remaining = Math.max(0, Math.ceil((state.arrivesAt - ctx.now) / 1000));
      return {
        label: remaining > 0 ? `ARRIVES IN ${remaining}s` : 'ANY SECOND NOW…',
        note: 'Close the app now to test it closed, then reopen it to see the result.',
        tips: [],
        tone: 'active',
        busy: true,
        progress: Math.min(1, Math.max(0, 1 - (state.arrivesAt - ctx.now) / (TEST_DELAY_S * 1000))),
      };
    }

    case 'received': {
      let note: string;
      if (state.via === 'local') {
        note = ctx.serverConfigured
          ? 'Local alerts work. Connect your server to test closed-app alerts.'
          : 'Local alerts work.';
      } else if (state.whileClosed) {
        note = 'It reached this phone while the app was closed. Closed-app alerts work.';
      } else {
        const when =
          state.lateBySeconds < 1.5
            ? 'within a second or two of being sent'
            : `${Math.round(state.lateBySeconds)}s after your server sent it`;
        note = `It arrived ${when}. Close the app next time to prove it works closed.`;
      }
      return { label: '✓ RECEIVED', note, tips: [], tone: 'good', busy: false };
    }

    case 'missed':
      return {
        label: 'NOT RECEIVED · TRY AGAIN',
        note:
          state.via === 'server'
            ? 'Nothing arrived. If you closed the app and saw the alert, you’re set. Otherwise check:'
            : 'Nothing arrived. Check:',
        tips: state.via === 'server' ? [PERMISSION_TIP, FOCUS_TIP, WRANGLER_TIP] : [PERMISSION_TIP, FOCUS_TIP],
        tone: 'bad',
        busy: false,
        action: 'open-settings',
      };

    case 'failed':
      return {
        label: 'COULDN’T SEND · TRY AGAIN',
        note: failureNote(state.reason, state.detail),
        tips: [],
        tone: 'bad',
        busy: false,
        action: state.reason === 'permission' ? 'open-settings' : undefined,
      };
  }
}
