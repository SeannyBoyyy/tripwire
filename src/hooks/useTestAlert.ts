import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { TEST_DELAY_S, reduce, type TestState, type Via } from '../domain/testAlert';
import {
  notifyTest,
  onNotificationReceived,
  requestNotifications,
  testNotificationPresented,
} from '../services/notify';
import { sendServerTest } from '../services/sync';

const IDLE: TestState = { phase: 'idle' };

/**
 * Runs the "send test alert" flow. The rules live in domain/testAlert; this hook
 * only supplies the side effects: sending, listening for the alert, the clock,
 * and haptics.
 */
export function useTestAlert(serverConnected: boolean) {
  const [state, dispatch] = useReducer(reduce, IDLE);
  const [now, setNow] = useState(() => Date.now());
  const phase = useRef(state.phase);
  phase.current = state.phase;

  // The alert landing while the app is open is the proof we're after.
  useEffect(
    () =>
      onNotificationReceived((data) => {
        if (data.test === true) dispatch({ type: 'arrived', at: Date.now() });
      }),
    [],
  );

  // A clock for the countdown and the give-up timeout, only while a test is running.
  const running = state.phase === 'sending' || state.phase === 'waiting';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      dispatch({ type: 'tick', now: t });
    }, 250);
    return () => clearInterval(timer);
  }, [running]);

  // If the user closed the app to test it, the banner is waiting in Notification Center on return.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || (phase.current !== 'waiting' && phase.current !== 'missed')) return;
      testNotificationPresented().then(
        (found) => {
          if (found) dispatch({ type: 'found-presented' });
        },
        () => undefined,
      );
    });
    return () => sub.remove();
  }, []);

  // Let the result be felt, not just seen.
  const last = useRef(state.phase);
  useEffect(() => {
    if (last.current === state.phase) return;
    last.current = state.phase;
    if (state.phase === 'received') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (state.phase === 'missed' || state.phase === 'failed') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [state.phase]);

  const start = useCallback(async () => {
    const via: Via = serverConnected ? 'server' : 'local';
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    dispatch({ type: 'press', via, at: Date.now() });
    try {
      if (!(await requestNotifications())) {
        dispatch({ type: 'failed', reason: 'permission' });
        return;
      }
      if (via === 'local') {
        await notifyTest();
        dispatch({ type: 'scheduled', arrivesAt: Date.now() });
        return;
      }
      const sent = await sendServerTest(TEST_DELAY_S);
      if (sent !== 'sent') {
        dispatch({ type: 'failed', reason: sent });
        return;
      }
      dispatch({ type: 'scheduled', arrivesAt: Date.now() + TEST_DELAY_S * 1000 });
    } catch (error) {
      dispatch({
        type: 'failed',
        reason: via === 'server' ? 'server' : 'local',
        detail: via === 'server' && error instanceof Error ? error.message : undefined,
      });
    }
  }, [serverConnected]);

  return { state, now, start };
}
