import { useLayoutEffect, type Dispatch } from 'react';
import { now } from './clock.ts';
import type { GameAction } from './game.ts';

/**
 * Horloge du cycle local : une seule minuterie vers la prochaine échéance, qui émet un `tick`
 * idempotent. Nettoyée au démontage (StrictMode compris) ; au retour d'un onglet masqué, un `tick`
 * immédiat traite l'échéance dépassée sans attendre la minuterie ralentie par le navigateur.
 *
 * Un navigateur peut déclencher `setTimeout` une fraction de milliseconde avant l'échéance mesurée
 * par `performance.now()` : le `tick` serait ignoré et plus rien ne serait planifié (mesuré en E2E).
 * La minuterie se réarme donc tant que l'échéance n'est pas atteinte. Elle est posée dans le commit
 * même du rendu (`useLayoutEffect`) : une phase affichée a toujours son échéance planifiée.
 */
export function useCycle(deadline: number | null, canSelect: boolean, dispatch: Dispatch<GameAction>): void {
  useLayoutEffect(() => {
    if (deadline === null) return undefined;
    let timer = 0;
    const tick = () => {
      dispatch({ type: 'tick', now: now(), canSelect });
    };
    const arm = () => {
      const remaining = deadline - now();
      if (remaining > 0) timer = window.setTimeout(arm, Math.ceil(remaining));
      else tick();
    };
    arm();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [deadline, canSelect, dispatch]);
}
