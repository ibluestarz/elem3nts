import {
  hasExactKeys,
  isChoicePair,
  isCounterPair,
  isFlagPair,
  isIdentifier,
  isJsonObject,
  isPhase,
  isRevision,
  isRoomCode,
  isRoundId,
  isResumablePhase,
  isRoundKind,
  isSettings,
  isSlot,
  isTimestamp,
  type RoomView,
} from '../shared/protocol/index.ts';

/**
 * Version du schéma persisté. Toute modification de la forme de `PersistedRoom` l'incrémente et
 * ajoute la migration `n → n + 1` dans `MIGRATIONS` (storage.ts), avec son test (DECISIONS D35).
 * v2 (PFC-012) : `createdAt` et places réservées (hash du token, échéance de première connexion).
 * v3 (PFC-014) : partie réglée (`settledMatchId`) et réponses mémorisées par place (`replies`).
 * v4 (PFC-017) : échéance de reconnexion (`reconnectDeadline`) et temps restant de la phase en pause
 * (`resumeRemainingMs`).
 * v5 (PFC-018) : instant de la dernière activité utile (`lastActivityAt`, expiration d'inactivité D16/D17).
 */
export const ROOM_SCHEMA_VERSION = 5;

/**
 * Durée maximale d'une phase chronométrée (ouverture, sélection, résultat le plus long) : borne de
 * cohérence du temps restant d'une pause, large pour ne jamais rejeter une chronologie réelle (D09).
 */
const MAX_PHASE_MS = 60_000;

/** Réponses mémorisées par place pour le dédoublonnage par `requestId` (PROTOCOL « Idempotence »). */
export const MAX_REPLIES = 128;

/**
 * Place réservée (PFC-012) : seul le SHA-256 du token de reprise est conservé, jamais le token.
 * `reservedUntil` est l'échéance de première connexion (30 s) ; il repasse à `null` dès que la place
 * s'authentifie (PFC-013) et n'existe plus ensuite : les absences relèvent de D15 (PFC-017).
 */
export interface Seat {
  readonly tokenHash: string;
  readonly reservedUntil: number | null;
}

export type Seats = readonly [host: Seat | null, guest: Seat | null];

/**
 * Réponse d'une commande acceptée qui a modifié la room, écrite dans la même transition : un doublon
 * (même `requestId`, même place) reçoit ce même `ack` sans aucun nouvel effet.
 */
export interface Reply {
  readonly requestId: string;
  readonly revision: number;
}

/** Réponses de chaque place, de la plus ancienne à la plus récente, `MAX_REPLIES` au plus. */
export type Replies = readonly [p1: readonly Reply[], p2: readonly Reply[]];

/**
 * État durable d'une room. v1 (PFC-011) : exactement la vue que lit la projection (`RoomView`).
 * v2 (PFC-012) : plus l'instant de création (durée maximale D16) et les places réservées. La
 * projection ne lit que `RoomView`, champ par champ : aucun hash n'atteint un `state`.
 * Toute évolution incrémente `ROOM_SCHEMA_VERSION` et ajoute sa migration (storage.ts, D35).
 */
export interface PersistedRoom extends RoomView {
  /** Instant serveur de création, en ms ; `0` pour une room v1 migrée, créée avant les places. */
  readonly createdAt: number;
  readonly seats: Seats;
  /**
   * Dernière partie dont les trophées sont réglés (R09/R10) : seule la partie courante peut l'être, et une
   * nouvelle partie ne commence qu'après le règlement de la précédente. `null` avant toute fin de partie.
   */
  readonly settledMatchId: string | null;
  readonly replies: Replies;
  /**
   * Échéance de reconnexion (D15, PFC-017) : fixée à la première absence d'une place déjà connectée,
   * jamais repoussée tant qu'une place reste absente, effacée quand toutes sont revenues. À l'échéance,
   * la room est fermée sans trophée. En `paused`, `deadline` vaut cette même échéance (publiée).
   */
  readonly reconnectDeadline: number | null;
  /** Temps restant de la phase interrompue (`resumePhase`), renseigné seulement en `paused`. */
  readonly resumeRemainingMs: number | null;
  /**
   * Instant serveur de la dernière activité utile (D16, D17, PFC-018), jamais antérieur à `createdAt` :
   * création, première connexion d'une place, ou commande acceptée qui modifie la room. Ni `ping`, ni
   * refus, ni reprise de place, ni échéance traitée (manche vide comprise) ne le déplacent.
   */
  readonly lastActivityAt: number;
}

/** SHA-256 en hexadécimal minuscule (64 caractères). */
const TOKEN_HASH = /^[0-9a-f]{64}$/;

const ROOM_KEYS = [
  'revision',
  'roomCode',
  'phase',
  'resumePhase',
  'settings',
  'settingsRevision',
  'match',
  'roundId',
  'selection',
  'lastRound',
  'trophies',
  'ready',
  'connected',
  'deadline',
  'createdAt',
  'seats',
  'settledMatchId',
  'replies',
  'reconnectDeadline',
  'resumeRemainingMs',
  'lastActivityAt',
] as const;

/**
 * Garde complète de l'état relu : forme exacte, types et bornes. Un état écrit par une version
 * boguée ou altéré n'atteint jamais la projection : la room est déclarée illisible.
 */
export function isPersistedRoom(value: unknown): value is PersistedRoom {
  if (!isJsonObject(value) || !hasExactKeys(value, ROOM_KEYS)) return false;
  const { phase, resumePhase } = value;
  if (!isPhase(phase)) return false;
  if (resumePhase !== null && !isResumablePhase(resumePhase)) return false;
  // `resumePhase` n'a de sens qu'en pause, et une pause sait toujours quoi reprendre.
  if ((phase === 'paused') !== (resumePhase !== null)) return false;
  return (
    isRevision(value['revision']) &&
    isRoomCode(value['roomCode']) &&
    isSettings(value['settings']) &&
    isRevision(value['settingsRevision']) &&
    (value['match'] === null || isMatch(value['match'])) &&
    (value['roundId'] === null || isRoundId(value['roundId'])) &&
    isChoicePair(value['selection']) &&
    (value['lastRound'] === null || isRevealedRound(value['lastRound'])) &&
    isCounterPair(value['trophies']) &&
    isFlagPair(value['ready']) &&
    isFlagPair(value['connected']) &&
    (value['deadline'] === null || isTimestamp(value['deadline'])) &&
    isTimestamp(value['createdAt']) &&
    hasCoherentSeats(value['seats'], value['connected'], value['match']) &&
    (value['settledMatchId'] === null || isIdentifier(value['settledMatchId'])) &&
    hasCoherentReplies(value['replies'], value['revision']) &&
    (value['reconnectDeadline'] === null || isTimestamp(value['reconnectDeadline'])) &&
    (value['resumeRemainingMs'] === null || isRemaining(value['resumeRemainingMs'])) &&
    isActivity(value['lastActivityAt'], value['createdAt']) &&
    hasCoherentGame(value as unknown as PersistedRoom) &&
    hasCoherentAbsence(value as unknown as PersistedRoom)
  );
}

/** Dernière activité : un instant jamais antérieur à la création (aucune activité avant la room). */
function isActivity(value: unknown, createdAt: unknown): boolean {
  return isTimestamp(value) && isTimestamp(createdAt) && value >= createdAt;
}

function isRemaining(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= MAX_PHASE_MS;
}

/** Place déjà connectée (première connexion faite) et absente : seule absence qui relève de D15. */
export function isAbsent(room: Pick<PersistedRoom, 'seats' | 'connected'>, slot: 0 | 1): boolean {
  const seat = room.seats[slot];
  return seat !== null && seat.reservedUntil === null && !room.connected[slot];
}

/**
 * Cohérence de l'absence (PFC-017) : une échéance de reconnexion existe si et seulement si une place
 * déjà connectée est absente ; une pause la publie comme `deadline` et garde son temps restant.
 */
function hasCoherentAbsence(room: PersistedRoom): boolean {
  const { phase, reconnectDeadline, resumeRemainingMs, deadline } = room;
  // Room fermée (départ, délai échu) : plus aucune échéance, quelle que soit la présence restante.
  if (phase === 'closed') return reconnectDeadline === null && resumeRemainingMs === null;
  const absent = isAbsent(room, 0) || isAbsent(room, 1);
  if ((reconnectDeadline !== null) !== absent) return false;
  if ((phase === 'paused') !== (resumeRemainingMs !== null)) return false;
  return phase !== 'paused' || deadline === reconnectDeadline;
}

/** Deux listes bornées de réponses, identifiants valides et uniques par place, révisions déjà atteintes. */
function hasCoherentReplies(replies: unknown, revision: unknown): boolean {
  if (!Array.isArray(replies) || replies.length !== 2 || !isRevision(revision)) return false;
  return replies.every((list: unknown) => {
    if (!Array.isArray(list) || list.length > MAX_REPLIES) return false;
    const ids = new Set<unknown>();
    return list.every((reply: unknown) => {
      if (!isJsonObject(reply) || !hasExactKeys(reply, ['requestId', 'revision'])) return false;
      const { requestId, revision: at } = reply;
      if (!isIdentifier(requestId) || !isRevision(at) || at > revision || ids.has(requestId)) return false;
      ids.add(requestId);
      return true;
    });
  });
}

/**
 * Cohérence de la partie avec la phase (champs déjà validés un à un) : une phase de jeu a sa partie
 * en cours et son échéance ; un résultat porte la manche courante ; une fin de partie est réglée une
 * fois, sans échéance. La partie réglée n'est jamais une partie en cours.
 */
function hasCoherentGame(room: PersistedRoom): boolean {
  const { phase, match, roundId, deadline, lastRound, settledMatchId } = room;
  if (match !== null && match.result.status === 'playing' && settledMatchId === match.id) return false;
  switch (phase) {
    case 'starting':
    case 'selecting':
      return match?.result.status === 'playing' && roundId !== null && deadline !== null;
    case 'round-result':
      return match !== null && roundId !== null && lastRound?.roundId === roundId && deadline !== null;
    case 'match-ended':
      return (
        (match?.result.status === 'won' || match?.result.status === 'draw') &&
        settledMatchId === match.id &&
        deadline === null
      );
    case 'paused':
      // Phase interrompue restituable telle quelle à la reprise (mêmes règles que ci-dessus).
      if (room.resumePhase === 'round-result') return match !== null && roundId !== null && lastRound?.roundId === roundId;
      return match?.result.status === 'playing' && roundId !== null;
    case 'lobby':
    case 'closed':
      return true;
  }
}

function isSeat(value: unknown): value is Seat {
  if (!isJsonObject(value) || !hasExactKeys(value, ['tokenHash', 'reservedUntil'])) return false;
  const { tokenHash, reservedUntil } = value;
  return typeof tokenHash === 'string' && TOKEN_HASH.test(tokenHash) && (reservedUntil === null || isTimestamp(reservedUntil));
}

/**
 * Places cohérentes avec la présence et la partie : pas d'invité sans hôte, deux hashes distincts,
 * une place connectée est réservée et n'attend plus sa première connexion, et une réservation
 * jamais connectée n'existe qu'avant toute partie (son expiration ne touche que le lobby).
 */
function hasCoherentSeats(seats: unknown, connected: unknown, match: unknown): boolean {
  if (!Array.isArray(seats) || seats.length !== 2 || !isFlagPair(connected)) return false;
  const host: unknown = seats[0];
  const guest: unknown = seats[1];
  if (!(host === null || isSeat(host)) || !(guest === null || isSeat(guest))) return false;
  if (host === null && guest !== null) return false;
  if (host !== null && guest !== null && host.tokenHash === guest.tokenHash) return false;
  return [host, guest].every((seat, slot) => {
    if (seat === null) return !connected[slot];
    if (seat.reservedUntil === null) return true;
    return !connected[slot] && match === null;
  });
}

function isMatch(value: unknown): boolean {
  if (!isJsonObject(value) || !hasExactKeys(value, ['id', 'settings', 'scores', 'result'])) return false;
  return (
    isIdentifier(value['id']) &&
    isSettings(value['settings']) &&
    isCounterPair(value['scores']) &&
    isMatchResult(value['result'])
  );
}

function isMatchResult(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  switch (value['status']) {
    case 'playing':
    case 'draw':
    case 'cancelled':
      return hasExactKeys(value, ['status']);
    case 'won':
      return hasExactKeys(value, ['status', 'winner']) && isSlot(value['winner']);
    default:
      return false;
  }
}

function isRevealedRound(value: unknown): boolean {
  if (!isJsonObject(value) || !hasExactKeys(value, ['roundId', 'choices', 'resolution'])) return false;
  return isRoundId(value['roundId']) && isChoicePair(value['choices']) && isResolution(value['resolution']);
}

function isResolution(value: unknown): boolean {
  if (!isJsonObject(value) || !hasExactKeys(value, ['kind', 'winner', 'before', 'after', 'delta'])) return false;
  const delta = value['delta'];
  return (
    isRoundKind(value['kind']) &&
    (value['winner'] === null || isSlot(value['winner'])) &&
    isCounterPair(value['before']) &&
    isCounterPair(value['after']) &&
    Array.isArray(delta) &&
    delta.length === 2 &&
    delta.every((step) => Number.isSafeInteger(step))
  );
}
