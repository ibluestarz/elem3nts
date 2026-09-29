import { ERROR_MESSAGES } from '../shared/protocol/index.ts';

interface HttpError {
  readonly status: number;
  /** Code public ; plusieurs motifs internes peuvent partager un code (même réaction du client). */
  readonly code: string;
  readonly message: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Erreurs de l'API HTTP (PROTOCOL « Erreurs HTTP ») : statut et message français **fixes par motif**.
 * Aucune donnée de la requête, pile d'appel ou détail de stockage n'est jamais renvoyé.
 */
const HTTP_ERRORS = {
  NOT_FOUND: { status: 404, code: 'NOT_FOUND', message: 'Ressource introuvable.' },
  METHOD_NOT_ALLOWED: {
    status: 405,
    code: 'METHOD_NOT_ALLOWED',
    message: 'Méthode non autorisée pour cette ressource.',
    headers: { allow: 'POST' },
  },
  /** Route de socket (`GET /api/rooms/:code/ws`) appelée avec une autre méthode. */
  SOCKET_METHOD_NOT_ALLOWED: {
    status: 405,
    code: 'METHOD_NOT_ALLOWED',
    message: 'Méthode non autorisée pour cette ressource.',
    headers: { allow: 'GET' },
  },
  /**
   * Route de socket sans demande d'upgrade WebSocket. Pas d'en-tête `Upgrade` : en-tête de connexion
   * que le runtime retire de toute réponse ; le code et le message suffisent.
   */
  UPGRADE_REQUIRED: { status: 426, code: 'UPGRADE_REQUIRED', message: 'Connexion WebSocket attendue.' },
  /**
   * Origin absente ou différente de celle du Worker (PFC-013) : refusée avant toute room, sans
   * donnée. Protège contre l'ouverture d'une socket par un site tiers (CSWSH).
   */
  ORIGIN_FORBIDDEN: { status: 403, code: 'ORIGIN_FORBIDDEN', message: 'Origine non autorisée.' },
  /**
   * Code mal formé, room inconnue, expirée ou fermée : une seule réponse, pour ne jamais révéler
   * si un code a existé.
   */
  ROOM_ABSENT: { status: 404, code: 'ROOM_UNAVAILABLE', message: ERROR_MESSAGES.ROOM_UNAVAILABLE },
  /** État de room illisible (PFC-011) : échec fermé. */
  ROOM_UNAVAILABLE: { status: 503, code: 'ROOM_UNAVAILABLE', message: ERROR_MESSAGES.ROOM_UNAVAILABLE },
  ROOM_FULL: { status: 409, code: 'ROOM_FULL', message: ERROR_MESSAGES.ROOM_FULL },
  /** Cinq codes tirés déjà pris (PROTOCOL) : rien n'est écrit, la création peut être réessayée. */
  CODE_COLLISION: {
    status: 503,
    code: 'CODE_COLLISION',
    message: 'Impossible de créer une partie pour le moment : réessayez.',
    headers: { 'retry-after': '1' },
  },
  INTERNAL: { status: 500, code: 'INTERNAL', message: 'Erreur interne du serveur : réessayez plus tard.' },
} as const satisfies Record<string, HttpError>;

export type HttpErrorReason = keyof typeof HTTP_ERRORS;

/** En-têtes de toute réponse JSON de l'API : jamais mise en cache, jamais réinterprétée par le navigateur. */
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
} as const;

export function jsonResponse(body: unknown, status: number, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

/** Réponse d'erreur `{ error: { code, message } }`. */
export function jsonError(reason: HttpErrorReason): Response {
  const error: HttpError = HTTP_ERRORS[reason];
  return jsonResponse({ error: { code: error.code, message: error.message } }, error.status, error.headers);
}
