import {
  ERROR_MESSAGES,
  RECONNECT_TIMEOUT_MS,
  ROOM_IDLE_TIMEOUT_MS,
  ROOM_MAX_DURATION_MS,
  type ErrorCode,
} from '../../shared/protocol/index.ts';
import type { EntryFailure } from './api.ts';
import type { EndReason } from './connection.ts';
import type { CodeInputError } from './invite.ts';

/** Textes du mode en ligne (français, D19) : chaque erreur dit ce qui s'est passé et quoi faire. */

export const CODE_INPUT_MESSAGES: Readonly<Record<CodeInputError, string>> = {
  empty: 'Saisissez le code reçu.',
  incomplete: 'Code incomplet — 8 caractères attendus.',
  'too-long': 'Code trop long — 8 caractères attendus.',
  'invalid-character': 'Caractère invalide : un code ne contient ni I, ni O, ni 0, ni 1.',
};

const NETWORK = 'Connexion impossible : vérifiez votre réseau puis réessayez.';
const SERVER = 'Le serveur n’a pas pu répondre : réessayez dans un instant.';

export const JOIN_FAILURES: Readonly<Record<EntryFailure, string>> = {
  ROOM_UNAVAILABLE: ERROR_MESSAGES.ROOM_UNAVAILABLE,
  ROOM_FULL: ERROR_MESSAGES.ROOM_FULL,
  CODE_COLLISION: SERVER,
  network: NETWORK,
  server: SERVER,
};

export const CREATE_FAILURES: Readonly<Record<EntryFailure, string>> = {
  ROOM_UNAVAILABLE: SERVER,
  ROOM_FULL: SERVER,
  CODE_COLLISION: 'Impossible de créer une partie pour le moment : réessayez.',
  network: NETWORK,
  server: SERVER,
};

/** Fin de connexion ; `left` dépend de qui est parti (l'autre joueur, jamais soi : un départ volontaire est silencieux). */
export function endMessage(reason: EndReason, opponent: string): string {
  switch (reason) {
    case 'left':
      return `${opponent} a quitté la partie.`;
    case 'inactive':
      return `Partie fermée après ${String(ROOM_IDLE_TIMEOUT_MS / 60_000)} minutes sans activité : aucun trophée attribué.`;
    case 'max-duration':
      return `Partie fermée : durée maximale de ${String(ROOM_MAX_DURATION_MS / 3_600_000)} heures atteinte, aucun trophée attribué.`;
    case 'reconnect-timeout':
      return `Partie fermée : ${opponent} n’est pas revenu dans les ${String(RECONNECT_TIMEOUT_MS / 1000)} secondes.`;
    case 'unauthorized':
      return ERROR_MESSAGES.UNAUTHORIZED;
    case 'room-unavailable':
      return ERROR_MESSAGES.ROOM_UNAVAILABLE;
    case 'replaced':
      return 'Partie reprise dans un autre onglet : cette page est déconnectée.';
    case 'limit':
      return 'Connexion interrompue : trop de messages envoyés.';
    case 'auth-timeout':
      return 'Connexion à la partie impossible : réessayez.';
    case 'closed-while-away':
      return 'La partie a été fermée pendant la coupure.';
    case 'lost':
      return 'Connexion perdue : la partie n’a pas pu reprendre dans les 30 secondes.';
  }
}

/**
 * Fins de session survenues pendant l'absence probable du joueur (expiration D16, room fermée pendant
 * une coupure) : le message reste affiché jusqu'à ce qu'il le ferme, au lieu de disparaître en 4 s.
 */
export function isLastingEnd(reason: EndReason): boolean {
  return reason === 'inactive' || reason === 'max-duration' || reason === 'closed-while-away';
}

/** Refus d'une commande : message fixe du protocole (jamais de donnée recopiée). */
export const commandError = (code: ErrorCode): string => ERROR_MESSAGES[code];

export const COPY_FAILED = 'Copie automatique impossible : copiez le lien ci-dessous.';
export const LINK_COPIED = 'Lien d’invitation copié.';

/** Choix refusé parce qu'il est arrivé après l'échéance du serveur : la manche est déjà révélée. */
export const LATE_CHOICE = 'Choix arrivé trop tard : la manche était déjà close.';
/** Départ d'une partie en ligne en cours (même texte qu'en local). */
export const MATCH_CANCELLED = 'Partie annulée : aucun trophée attribué.';

/** Reprise d'une coupure du lien (PFC-017) : la socket est de nouveau authentifiée. */
export const LINK_RESTORED = 'Connexion rétablie.';
/** Choix refusé parce que la manche a été mise en pause (absence d'un joueur, D15). */
export const PAUSED_CHOICE = 'Choix non pris en compte : la manche est en pause.';
