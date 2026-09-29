import { useEffect, useState } from 'react';
import type { LayoutLabels } from '../input/keys.ts';

interface KeyboardWithLayout {
  getLayoutMap?: () => Promise<ReadonlyMap<string, string>>;
}

/**
 * Disposition réelle via la Keyboard Layout API : `pending` pendant la requête, `unavailable`
 * si le navigateur ne la fournit pas (Firefox, Safari), la refuse ou renvoie une table sans les
 * touches lettres (mesuré : table vide sous Chromium sans session graphique), sinon la table.
 */
export type LayoutState = 'pending' | 'unavailable' | LayoutLabels;

export function useLayoutState(): LayoutState {
  const [state, setState] = useState<LayoutState>(() => {
    const keyboard = (navigator as Navigator & { keyboard?: KeyboardWithLayout }).keyboard;
    return keyboard?.getLayoutMap ? 'pending' : 'unavailable';
  });
  useEffect(() => {
    let active = true;
    const keyboard = (navigator as Navigator & { keyboard?: KeyboardWithLayout }).keyboard;
    keyboard
      ?.getLayoutMap?.()
      .then((map) => {
        if (active) setState(map.has('KeyA') ? map : 'unavailable');
      })
      .catch(() => {
        // API refusée (contexte non sécurisé, iframe) : repli sur la disposition choisie.
        if (active) setState('unavailable');
      });
    return () => {
      active = false;
    };
  }, []);
  return state;
}

/** Table des touches si l'API l'a fournie, sinon `null`. */
export const layoutLabels = (state: LayoutState): LayoutLabels | null => (typeof state === 'string' ? null : state);
