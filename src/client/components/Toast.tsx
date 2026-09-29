import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ToastContext, type ToastOptions } from './toastContext.ts';
import './Toast.css';

const DISMISS_MS = 4000;
const EXIT_MS = 200;

interface ToastItem {
  readonly id: number;
  readonly message: string;
  readonly leaving: boolean;
  /** Jamais fermée automatiquement (`ToastOptions.persistent`). */
  readonly persistent: boolean;
}

/**
 * Notifications non bloquantes : région `status` toujours présente, disparition après 4 s,
 * suspendue tant que le pointeur ou le focus est sur une notification. Une notification
 * persistante reste jusqu'à son bouton de fermeture (WCAG 2.2.1 : aucun délai imposé).
 */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [items, setItems] = useState<readonly ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());
  const paused = useRef(false);
  const regionRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  /** Élément focalisé avant l'entrée du focus dans la région : rendu à la fermeture (PFC-021). */
  const origin = useRef<HTMLElement | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const clearTimer = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const remove = useCallback((id: number) => {
    timers.current.delete(id);
    setItems((list) => list.filter((item) => item.id !== id));
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      clearTimer(id);
      setItems((list) => list.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
      timers.current.set(
        id,
        window.setTimeout(() => {
          remove(id);
        }, EXIT_MS),
      );
    },
    [clearTimer, remove],
  );

  const schedule = useCallback(
    (id: number) => {
      clearTimer(id);
      if (paused.current) return;
      timers.current.set(
        id,
        window.setTimeout(() => {
          dismiss(id);
        }, DISMISS_MS),
      );
    },
    [clearTimer, dismiss],
  );

  const show = useCallback(
    (message: string, options?: ToastOptions) => {
      nextId.current += 1;
      const id = nextId.current;
      const persistent = options?.persistent === true;
      // Un message identique encore affiché est remplacé : pas d'empilement sur clics répétés.
      for (const item of itemsRef.current) if (item.message === message && !item.leaving) clearTimer(item.id);
      setItems((list) => [
        ...list.filter((item) => item.message !== message || item.leaving).slice(-2),
        { id, message, leaving: false, persistent },
      ]);
      if (!persistent) schedule(id);
    },
    [clearTimer, schedule],
  );

  // Suspension au survol ou au focus, reprise à la sortie : écouteurs natifs sur la région.
  useEffect(() => {
    const region = regionRef.current;
    if (!region) return undefined;
    const pause = (event: Event) => {
      const previous = (event as FocusEvent).relatedTarget;
      if (event.type === 'focusin' && previous instanceof HTMLElement && !region.contains(previous)) origin.current = previous;
      paused.current = true;
      for (const item of itemsRef.current) if (!item.leaving) clearTimer(item.id);
    };
    const resume = (event: Event) => {
      const next = (event as FocusEvent).relatedTarget;
      if (next instanceof Node && region.contains(next)) return;
      paused.current = false;
      for (const item of itemsRef.current) if (!item.leaving && !item.persistent) schedule(item.id);
    };
    region.addEventListener('pointerenter', pause);
    region.addEventListener('pointerleave', resume);
    region.addEventListener('focusin', pause);
    region.addEventListener('focusout', resume);
    return () => {
      region.removeEventListener('pointerenter', pause);
      region.removeEventListener('pointerleave', resume);
      region.removeEventListener('focusin', pause);
      region.removeEventListener('focusout', resume);
    };
  }, [clearTimer, schedule]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  // Fermer une notification au clavier ne laisse pas le focus sur un bouton qui disparaît (retour au <body>) :
  // il revient à l'élément d'origine, sinon au titre de l'écran.
  const close = useCallback(
    (id: number) => {
      const region = regionRef.current;
      if (region?.contains(document.activeElement)) {
        const back = origin.current?.isConnected ? origin.current : document.querySelector<HTMLElement>('[data-focus-target]');
        back?.focus({ preventScroll: true });
      }
      dismiss(id);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite" ref={regionRef}>
        {items.map((item) => (
          <div key={item.id} className={item.leaving ? 'toast toast--leaving' : 'toast'}>
            <span className="toast__mark" aria-hidden="true" />
            <span className="toast__message">{item.message}</span>
            <button
              type="button"
              className="toast__close"
              aria-label="Fermer la notification"
              onClick={() => {
                close(item.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
