/** Codes d'erreur du protocole v1, dans l'ordre de PROTOCOL. */
export const ERROR_CODES = [
  'INVALID_MESSAGE',
  'INVALID_SETTINGS',
  'ROOM_UNAVAILABLE',
  'ROOM_FULL',
  'UNAUTHORIZED',
  'NOT_HOST',
  'INVALID_PHASE',
  'STALE_ROUND',
  'STALE_SETTINGS',
  'CHOICE_LOCKED',
  'RATE_LIMITED',
  'VERSION_UNSUPPORTED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Message humain, en français, **fixe par code** : aucune donnée reçue (identifiant, valeur,
 * token) n'y est jamais recopiée, ce qui exclut toute réflexion d'entrée et toute fuite.
 */
export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = Object.freeze({
  INVALID_MESSAGE: 'Message invalide : il a été ignoré.',
  INVALID_SETTINGS: 'Réglages invalides : objectif X entier de 1 à 10 attendu.',
  ROOM_UNAVAILABLE: 'Cette partie n’existe pas ou n’est plus disponible.',
  ROOM_FULL: 'Cette partie est déjà complète.',
  UNAUTHORIZED: 'Connexion non reconnue : rejoignez la partie à nouveau.',
  NOT_HOST: 'Seul Joueur 1 peut modifier les réglages.',
  INVALID_PHASE: 'Action impossible à ce moment de la partie.',
  STALE_ROUND: 'Cette manche est déjà terminée.',
  STALE_SETTINGS: 'Les réglages viennent de changer : vérifiez-les avant de confirmer.',
  CHOICE_LOCKED: 'Votre choix est déjà verrouillé.',
  RATE_LIMITED: 'Trop de messages envoyés : patientez un instant.',
  VERSION_UNSUPPORTED: 'Version du jeu dépassée : rechargez la page.',
});

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
