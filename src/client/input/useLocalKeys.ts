import { useEffect, useRef } from 'react';
import { learnedLabel, resolveBinding, type KeyBindings, type KeySlot } from './keys.ts';

/** Cible d'une saisie de texte : les touches de jeu y restent du texte (SPEC saisie). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]') !== null;
}

/** Cible d'une frappe qui a sa propre action native ou de saisie : le raccourci global s'efface. */
export function ownsKey(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest('input, textarea, select, button, a[href], summary, [role="button"], [role="switch"]') !== null;
}

interface LocalKeysOptions {
  /** Écoute installée pendant l'arène sur clavier partagé. */
  readonly enabled: boolean;
  /**
   * Lu à chaque frappe : vrai seulement pendant la sélection. Mis à jour de façon synchrone à
   * l'échéance, pour qu'une frappe arrivant avant le rendu suivant ne soit ni perdue ni anticipée.
   */
  readonly accepting: { readonly current: boolean };
  readonly bindings: KeyBindings;
  readonly onChoose: (slot: KeySlot) => void;
  /** Libellé réel observé pour un code physique (corrige l'affichage des touches). */
  readonly onLearn: (code: string, label: string) => void;
}

/**
 * Clavier partagé (D10) : chaque touche liée choisit pour sa place, par code physique, sans
 * accord de plusieurs touches. Une lettre n'a pas d'action native : elle agit même si un bouton
 * a le focus. `repeat`, modificateurs et champs éditables sont ignorés.
 */
export function useLocalKeys({ enabled, accepting, bindings, onChoose, onLearn }: LocalKeysOptions): void {
  const callbacks = useRef({ onChoose, onLearn });
  useEffect(() => {
    callbacks.current = { onChoose, onLearn };
  }, [onChoose, onLearn]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!accepting.current || isEditableTarget(event.target)) return;
      const slot = resolveBinding(bindings, event.code);
      if (!slot) return;
      event.preventDefault();
      const label = learnedLabel(event);
      if (label !== null) callbacks.current.onLearn(event.code, label);
      callbacks.current.onChoose(slot);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled, accepting, bindings]);
}
