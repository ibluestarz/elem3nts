/**
 * Transport WebSocket d'une room (PFC-013) : constantes partagées par le Worker et le client en ligne.
 * La socket s'ouvre sur `GET /api/rooms/:code/ws`, même origine ; le token ne figure jamais dans l'URL.
 */

/** Délai pour authentifier une socket ouverte ; au-delà (ou à l'instant exact), fermeture sans donnée. */
export const AUTH_TIMEOUT_MS = 5000;

/**
 * Délai de reconnexion d'une place absente (D15), compté depuis la première absence, jamais repoussé
 * par une nouvelle absence ou une tentative : à l'échéance (ou à l'instant exact), la room est fermée
 * sans trophée (`reconnect-timeout`). Le client borne ses propres tentatives à la même durée.
 */
export const RECONNECT_TIMEOUT_MS = 30_000;

/**
 * Inactivité maximale d'une room (D16, D17) : sans activité utile pendant ce délai (ou à l'instant exact),
 * la room est fermée sans trophée (`inactive`). Activité utile : commande acceptée qui modifie la room
 * (réglages, confirmation, choix verrouillé) ou première connexion d'une place ; jamais un `ping`, un
 * refus, une reprise de place ni une manche sans aucun choix.
 */
export const ROOM_IDLE_TIMEOUT_MS = 30 * 60_000;

/** Durée maximale absolue d'une room depuis sa création (D16), pause comprise (`max-duration`). */
export const ROOM_MAX_DURATION_MS = 4 * 60 * 60_000;

/** Débit soutenu par connexion (PROTOCOL « Idempotence et validation »). */
export const MESSAGES_PER_SECOND = 20;

/** Rafale admise par connexion au-delà du débit soutenu. */
export const MESSAGE_BURST = 30;

/** Dépassements consécutifs (taille ou débit) avant fermeture de la connexion. */
export const MAX_CONSECUTIVE_VIOLATIONS = 3;

/**
 * Codes de fermeture applicatifs (plage 4000–4999, RFC 6455 § 7.4.2), fixes et sans donnée de room :
 * le client décide de sa réaction sur le seul code.
 */
export const SOCKET_CLOSE_CODES = Object.freeze({
  /** Première trame autre qu'un `authenticate` valide, ou token refusé : oublier le token, rejoindre à nouveau. */
  UNAUTHORIZED: 4401,
  /** Room absente, expirée, fermée ou illisible. */
  ROOM_UNAVAILABLE: 4404,
  /** Aucune authentification valide dans les 5 s. */
  AUTH_TIMEOUT: 4408,
  /** Une connexion plus récente de la même place a pris le relais : ne pas se reconnecter automatiquement. */
  REPLACED: 4409,
  /** Trois dépassements consécutifs de taille ou de débit. */
  LIMIT_EXCEEDED: 4429,
} as const);

export type SocketCloseCode = (typeof SOCKET_CLOSE_CODES)[keyof typeof SOCKET_CLOSE_CODES];

/** Chemin d'ouverture de la socket d'une room (code déjà canonique). */
export function roomSocketPath(roomCode: string): string {
  return `/api/rooms/${roomCode}/ws`;
}
