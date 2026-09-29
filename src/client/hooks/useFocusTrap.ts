import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Garde Tab et Maj+Tab à l'intérieur d'un dialogue modal. `active` suit l'ouverture d'un dialogue qui
 * rend `null` fermé : sans lui, l'effet s'exécuterait avant que la ref ne pointe sur le dialogue (PFC-021).
 * Depuis un élément du dialogue hors séquence (titre `tabIndex=-1` focalisé à l'ouverture), Tab va au
 * premier contrôle et Maj+Tab au dernier, au lieu de sortir du dialogue.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    const container = ref.current;
    if (!active || !container) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      const active = document.activeElement;
      const outside = !(active instanceof HTMLElement) || !items.includes(active);
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref, active]);
}
