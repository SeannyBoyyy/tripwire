import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { loadTripwires, updateTripwires } from '../services/storage';
import type { NewTripwire, Tripwire } from '../domain/types';

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function useTripwires() {
  const [all, setAll] = useState<Tripwire[]>([]);

  const reload = useCallback(async () => setAll(await loadTripwires()), []);

  useEffect(() => {
    reload();
    // The background task may have tripped something while we were away.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') reload();
    });
    return () => sub.remove();
  }, [reload]);

  const arm = useCallback(async (wire: NewTripwire) => {
    setAll(
      await updateTripwires((list) => [
        { ...wire, id: newId(), createdAt: Date.now(), status: 'armed' },
        ...list,
      ]),
    );
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
