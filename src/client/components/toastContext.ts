import { createContext, useContext } from 'react';

export interface ToastOptions {
  /**
   * Message à ne pas manquer (fermeture survenue pendant l'absence probable du joueur) : aucune
   * disparition automatique, fermé seulement par son bouton.
   */
  readonly persistent?: boolean;
}

export interface ToastApi {
  /** Affiche un message non bloquant, annoncé poliment aux lecteurs d'écran ; bref, sauf `persistent`. */
  readonly show: (message: string, options?: ToastOptions) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast doit être utilisé dans un ToastProvider.');
  return api;
}
