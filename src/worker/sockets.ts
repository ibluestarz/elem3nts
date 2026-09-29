import type { PlayerIndex } from '../domain/index.ts';
import {
  MAX_CONSECUTIVE_VIOLATIONS,
  MAX_MESSAGE_BYTES,
  MESSAGES_PER_SECOND,
  MESSAGE_BURST,
  utf8ByteLength,
} from '../shared/protocol/index.ts';

/**
 * Identité d'une connexion, tenue en mémoire par la room tant que la socket vit : les sockets
 * standard meurent avec l'instance du Durable Object, aucune ne survit à une reconstruction (D37).
 * Ce n'est pas une seconde vérité métier : place et présence sont persistées.
 * Cycle unique `pending → player → retired` : une socket retirée ne redevient jamais active, et la
 * room garde au plus une socket `player` par place (la génération courante, seule à pouvoir écrire).
 */
export type Connection =
  /** Ouverte, non authentifiée : seule une trame `authenticate` est acceptée, avant `authDeadline`. */
  | { readonly kind: 'pending'; readonly authDeadline: number }
  /** Authentifiée pour `slot`. */
  | { readonly kind: 'player'; readonly slot: PlayerIndex }
  /** Remplacée, refusée ou fermée par le serveur : ses trames éventuelles sont ignorées. */
  | { readonly kind: 'retired' };

export const RETIRED: Connection = Object.freeze({ kind: 'retired' });

/**
 * Budget de messages d'une connexion : seau de jetons (20/s, rafale 30) et compteur de dépassements
 * consécutifs, mesurés avec l'horloge serveur.
 */
export interface Budget {
  tokens: number;
  updatedAt: number;
  violations: number;
}

export function freshBudget(now: number): Budget {
  return { tokens: MESSAGE_BURST, updatedAt: now, violations: 0 };
}

/**
 * Décompte d'une trame reçue. `ok` : dans le débit et la taille, le compteur de dépassements repart
 * à zéro. Sinon, un dépassement (`rate` ou `size`) ; le troisième consécutif rend `close`.
 * Toute trame consomme un jeton, même refusée : un flot de trames trop grandes reste borné.
 */
export function spend(budget: Budget, message: string | ArrayBuffer, now: number): 'ok' | 'rate' | 'size' | 'close' {
  const elapsed = Math.max(0, now - budget.updatedAt);
  budget.tokens = Math.min(MESSAGE_BURST, budget.tokens + (elapsed * MESSAGES_PER_SECOND) / 1000);
  budget.updatedAt = now;
  let outcome: 'ok' | 'rate' | 'size';
  if (budget.tokens < 1) outcome = 'rate';
  else {
    budget.tokens -= 1;
    outcome = byteLength(message) > MAX_MESSAGE_BYTES ? 'size' : 'ok';
  }
  if (outcome === 'ok') {
    budget.violations = 0;
    return 'ok';
  }
  budget.violations += 1;
  return budget.violations >= MAX_CONSECUTIVE_VIOLATIONS ? 'close' : outcome;
}

function byteLength(message: string | ArrayBuffer): number {
  return typeof message === 'string' ? utf8ByteLength(message, MAX_MESSAGE_BYTES) : message.byteLength;
}
