import { useCallback, useSyncExternalStore } from 'react';
import { now } from '../state/clock.ts';
import type { Phase } from '../state/game.ts';
import { phaseAt, type Segment } from './game.ts';

/**
 * Moment affiché d'une chronologie publiée par le serveur (`timelineOf`) : un rendu par changement
 * de moment, jamais par image. Une seule minuterie vers le prochain début, réarmée si le navigateur
 * la déclenche en avance (comme `useCycle`, D31) ; au retour d'un onglet masqué, relecture immédiate.
 * La chronologie ne contient que des moments déjà décidés : l'horloge locale n'en ajoute aucun.
 */
export function useTimelinePhase(timeline: readonly Segment[]): Phase {
  const subscribe = useCallback(
    (notify: () => void) => {
      let timer = 0;
      const arm = () => {
        const current = now();
        let next = Infinity;
        for (const { start } of timeline) if (start > current && start < next) next = start;
        if (next === Infinity) return;
        timer = window.setTimeout(() => {
          notify();
          arm();
        }, Math.ceil(next - current));
      };
      arm();
      const onVisibility = () => {
        if (document.visibilityState === 'visible') notify();
      };
      document.addEventListener('visibilitychange', onVisibility);
      return () => {
        window.clearTimeout(timer);
        document.removeEventListener('visibilitychange', onVisibility);
      };
    },
    [timeline],
  );
  const getSnapshot = useCallback(() => phaseAt(timeline, now()), [timeline]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
