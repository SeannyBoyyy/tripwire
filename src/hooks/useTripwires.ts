import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { MAX_ARMED } from '../domain/rules';
import { loadTripwires, updateTripwires } from '../services/storage';
import type { NewTripwire, Tripwire } from '../domain/types';

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function useTripwires() {
  const [all, setAll] = useState<Tripwire[]>([]);

  const reload = useCallback(async () => {
    try {
      setAll(await loadTripwires());
    } catch {
      // Couldn't read the saved list. Keep what is on screen; nothing is lost, and the next reload tries again.
    }
  }, []);

  useEffect(() => {
    reload();
    // The background task may have tripped something while we were away.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') reload();
    });
    return () => sub.remove();
  }, [reload]);

  /** Resolves false, and adds nothing, when MAX_ARMED wires are already armed. */
  const arm = useCallback(async (wire: NewTripwire): Promise<boolean> => {
    const id = newId();
    const next = await updateTripwires((list) =>
      list.filter((t) => t.status === 'armed').length >= MAX_ARMED
        ? list
        : [{ ...wire, id, createdAt: Date.now(), status: 'armed' }, ...list],
    );
    setAll(next);
    return next.some((t) => t.id === id);
  }, []);

  const remove = useCallback(async (id: string) => {
    setAll(await updateTripwires((list) => list.filter((t) => t.id !== id)));
  }, []);

  const clearTripped = useCallback(async () => {
    setAll(await updateTripwires((list) => list.filter((t) => t.status === 'armed')));
  }, []);

  const armed = useMemo(() => all.filter((t) => t.status === 'armed'), [all]);
  const tripped = useMemo(
    () =>
      all
        .filter((t) => t.status === 'tripped')
        .sort((a, b) => (b.trippedAt ?? 0) - (a.trippedAt ?? 0)),
    [all],
  );

  return { armed, tripped, reload, arm, remove, clearTripped };
}
