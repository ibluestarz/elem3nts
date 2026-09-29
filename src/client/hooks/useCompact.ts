import { useLayoutEffect, useState, type RefObject } from 'react';

/** Seuil de la maquette : sous 720 px de large, la scène passe en présentation téléphone. */
export const COMPACT_MAX_WIDTH = 720;

/** Vrai quand l'élément observé est plus étroit que le seuil, mesuré avant l'affichage. */
export function useCompact(ref: RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      setCompact(element.clientWidth < COMPACT_MAX_WIDTH);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return compact;
}
