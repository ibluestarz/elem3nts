import type { PlayerIndex } from '../domain/index.ts';
import type { CloseReason, CommandType, Phase } from '../shared/protocol/index.ts';
import { RoomStorageError } from './errors.ts';

/**
 * Journal structuré du Worker (PFC-020, D45, PROTOCOL « Journalisation et nettoyage »). Chaque événement
 * est un objet JSON unique passé à `console.log`, que Workers Logs indexe champ par champ.
 *
 * Allowlist : l'enregistrement est reconstruit champ par champ, sans étalement ; un champ inconnu n'est
 * jamais écrit. Ne sont **jamais** journalisés : token ou empreinte, `requestId` (choisi par le client,
 * un token y tiendrait), contenu ou charge d'une trame, choix, code de room (il vaut invitation),
 * adresse IP, message ou pile d'une erreur (seul son nom). La room est désignée par l'identifiant
 * technique de son Durable Object.
 */
export type LogEvent =
  /** Requête HTTP refusée avant toute room : origine (403) ou limite de débit (429). */
  | 'http.rejected'
  /** Erreur inattendue du Worker : réponse `500 INTERNAL` à message fixe. */
  | 'http.internal'
  /** Limiteur injoignable : la requête passe sans limite (D45), la panne est signalée. */
  | 'limiter.unavailable'
  | 'room.created'
  | 'seat.reserved'
  /** J2 jamais connecté dans son délai : place libérée, la room reste ouverte. */
  | 'seat.released'
  /** Place sans socket courante : absente, partie en pause (D15). */
  | 'seat.absent'
  /** Échéance de jeu traitée (ouverture, sélection, résultat) : une transition persistée. */
  | 'room.advanced'
  /** Socket en attente fermée pour faire place à une nouvelle (plafond par room). */
  | 'socket.evicted'
  | 'socket.authenticated'
  /** Commande acceptée qui a modifié la room (type seulement, jamais la charge). */
  | 'command.applied'
  /** Trame refusée : code d'erreur du protocole. */
  | 'message.rejected'
  | 'socket.closed'
  | 'room.closed'
  /** Socket ouverte sur une room absente, expirée, fermée ou illisible : fermée en 4404. */
  | 'socket.refused'
  /** Erreur inattendue pendant une trame ou une fermeture (1011 si la socket est fermée). */
  | 'socket.internal'
  /** Traitement d'alarme en échec, sans publication : le runtime le relance. */
  | 'alarm.failed';

export interface LogFields {
  /** Identifiant technique du Durable Object de la room (hexadécimal), jamais le code. */
  readonly room?: string;
  /** Phase persistée après l'événement. */
  readonly phase?: Phase;
  readonly match?: string | null;
  readonly round?: number | null;
  readonly revision?: number;
  readonly slot?: PlayerIndex;
  /** Code d'erreur public (protocole ou HTTP). */
  readonly code?: string;
  /** Code de fermeture WebSocket. */
  readonly close?: number;
  /** `server` : fermeture décidée par la room ; `client` : par le client ou le réseau. */
  readonly by?: 'server' | 'client';
  readonly command?: CommandType;
  readonly bucket?: 'entry' | 'socket';
  /** Motif de fermeture de room ; `host-absent` : J1 jamais connecté dans son délai de réservation. */
  readonly reason?: CloseReason | 'host-absent';
  readonly durationMs?: number;
  /** Nom de l'erreur (`Error.name`) ou code de stockage, jamais son message. */
  readonly error?: string;
}

/**
 * Champs journalisables, dans l'ordre d'écriture. `satisfies` impose à la compilation que chaque champ de
 * `LogFields` y figure exactement une fois.
 */
const LOG_KEYS = Object.keys({
  room: true,
  phase: true,
  match: true,
  round: true,
  revision: true,
  slot: true,
  code: true,
  close: true,
  by: true,
  command: true,
  bucket: true,
  reason: true,
  durationMs: true,
  error: true,
} satisfies Record<keyof LogFields, true>) as readonly (keyof LogFields)[];

/** Enregistrement émis pour `event` : seuls les champs de l'allowlist, définis, dans un ordre stable. */
export function logRecord(event: LogEvent, fields: LogFields = {}): Readonly<Record<string, unknown>> {
  const record: Record<string, unknown> = { event };
  for (const key of LOG_KEYS) {
    if (fields[key] !== undefined) record[key] = fields[key];
  }
  return record;
}

export function logEvent(event: LogEvent, fields?: LogFields): void {
  console.log(logRecord(event, fields));
}

/** Nom d'une erreur levée, pour `error` : jamais son message, qui pourrait porter une donnée reçue. */
export function errorName(error: unknown): string {
  if (error instanceof RoomStorageError) return `${error.name}:${error.code}`;
  return error instanceof Error ? error.name : typeof error;
}
