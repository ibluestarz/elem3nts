import { useLayoutEffect, type Dispatch } from 'react';
import { now } from './clock.ts';
import type { CycleTick } from './game.ts';

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
/**
 * `hotseat` : la prochaine manche s'ouvre en tour par tour (un seul téléphone, PFC-025). Toute machine à
 * échéances qui accepte ce `tick` s'en sert (cycle local, démo des confrontations).
 */
export function useCycle(deadline: number | null, hotseat: boolean, dispatch: Dispatch<CycleTick>): void {
  useLayoutEffect(() => {
    if (deadline === null) return undefined;
    let timer = 0;
    const tick = () => {
      dispatch({ type: 'tick', now: now(), hotseat });
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
  }, [deadline, hotseat, dispatch]);
}
