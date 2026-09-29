import { TARGET_MAX, TARGET_MIN, isElement, type Element, type MatchSettings } from '../../domain/index.ts';
import type { ErrorCode } from './errors.ts';
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  isIdentifier,
  isResumeToken,
  isRevision,
  isRoundId,
  utf8ByteLength,
} from './limits.ts';
import { hasExactKeys, isJsonObject, type JsonObject } from './schema.ts';

/** Commandes client → serveur, dans l'ordre de PROTOCOL. */
export const COMMAND_TYPES = [
  'authenticate',
  'update-settings',
  'ready',
  'submit-choice',
  'rematch-ready',
  'leave',
  'ping',
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];

interface Envelope<T extends CommandType, P> {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: T;
  /** Clé d'idempotence choisie par le client, unique par place (dédupliquée par le serveur). */
  readonly requestId: string;
  readonly payload: P;
}

type EmptyPayload = Readonly<Record<string, never>>;

/** Seul message accepté avant authentification ; le token ne figure jamais dans une URL ni un log. */
export type AuthenticateCommand = Envelope<'authenticate', { readonly resumeToken: string }>;

export type UpdateSettingsCommand = Envelope<
  'update-settings',
  { readonly expectedSettingsRevision: number; readonly settings: MatchSettings }
>;

export type ReadyCommand = Envelope<'ready', { readonly expectedSettingsRevision: number }>;

export type SubmitChoiceCommand = Envelope<'submit-choice', { readonly element: Element }> & {
  readonly matchId: string;
  readonly roundId: number;
};

/** `matchId` : la partie terminée que la revanche confirme ; une confirmation retardée ne vise jamais la suivante. */
export type RematchReadyCommand = Envelope<'rematch-ready', { readonly expectedSettingsRevision: number }> & {
  readonly matchId: string;
};

export type LeaveCommand = Envelope<'leave', EmptyPayload>;

export type PingCommand = Envelope<'ping', EmptyPayload>;

export type ClientCommand =
  | AuthenticateCommand
  | UpdateSettingsCommand
  | ReadyCommand
  | SubmitChoiceCommand
  | RematchReadyCommand
  | LeaveCommand
  | PingCommand;

/**
 * Motif technique d'un refus, pour les journaux et la politique de dépassement (PFC-013) ;
 * jamais transmis au client, qui ne reçoit que le code et son message fixe.
 */
export type RejectReason =
  | 'not-text'
  | 'too-large'
  | 'not-json'
  | 'not-object'
  | 'bad-version'
  | 'unknown-type'
  | 'bad-envelope'
  | 'bad-payload'
  | 'bad-settings';

export type ParseRejection = {
  readonly ok: false;
  readonly code: Extract<ErrorCode, 'INVALID_MESSAGE' | 'INVALID_SETTINGS' | 'VERSION_UNSUPPORTED'>;
  readonly reason: RejectReason;
} & ({ readonly requestId: string } | { readonly requestId?: never });

export type ParseResult = { readonly ok: true; readonly command: ClientCommand } | ParseRejection;

/** Clés d'enveloppe propres à chaque commande, en plus de `v`, `type`, `requestId` et `payload`. */
const CONTEXT_KEYS: Readonly<Record<CommandType, readonly string[]>> = {
  authenticate: [],
  'update-settings': [],
  ready: [],
  'submit-choice': ['matchId', 'roundId'],
  'rematch-ready': ['matchId'],
  leave: [],
  ping: [],
};

const ENVELOPE_KEYS = ['v', 'type', 'requestId', 'payload'] as const;

/**
 * Valide une trame reçue du client (`unknown` à l'entrée, union discriminée à la sortie). Fonction
 * pure : elle ne lève jamais, ne modifie pas son entrée et renvoie un objet neuf, gelé, construit
 * champ par champ (aucune clé inattendue ne peut le traverser).
 *
 * Ordre : trame texte ≤ 4 KiB → JSON objet → version → type → enveloppe exacte → payload exact.
 */
export function parseClientMessage(raw: unknown): ParseResult {
  if (typeof raw !== 'string') return reject('INVALID_MESSAGE', 'not-text');
  // Un octet UTF-8 au moins par unité UTF-16 : une chaîne trop longue est refusée sans la parcourir.
  if (raw.length > MAX_MESSAGE_BYTES || utf8ByteLength(raw, MAX_MESSAGE_BYTES) > MAX_MESSAGE_BYTES) {
    return reject('INVALID_MESSAGE', 'too-large');
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return reject('INVALID_MESSAGE', 'not-json');
  }
  if (!isJsonObject(data)) return reject('INVALID_MESSAGE', 'not-object');

  // Le requestId n'est renvoyé que s'il est lui-même valide : jamais de texte libre réfléchi.
  const requestId = isIdentifier(data['requestId']) ? data['requestId'] : undefined;
  const version = data['v'];
  if (!Number.isSafeInteger(version)) return reject('INVALID_MESSAGE', 'bad-version', requestId);
  if (version !== PROTOCOL_VERSION) return reject('VERSION_UNSUPPORTED', 'bad-version', requestId);

  const type = data['type'];
  if (!isCommandType(type)) return reject('INVALID_MESSAGE', 'unknown-type', requestId);
  if (!hasExactKeys(data, [...ENVELOPE_KEYS, ...CONTEXT_KEYS[type]]) || requestId === undefined) {
    return reject('INVALID_MESSAGE', 'bad-envelope', requestId);
  }
  const payload = data['payload'];
  if (!isJsonObject(payload)) return reject('INVALID_MESSAGE', 'bad-payload', requestId);

  const command = buildCommand(type, requestId, data, payload);
  return command === 'bad-envelope' || command === 'bad-payload' || command === 'bad-settings'
    ? reject(command === 'bad-settings' ? 'INVALID_SETTINGS' : 'INVALID_MESSAGE', command, requestId)
    : Object.freeze({ ok: true, command });
}

type Failure = 'bad-envelope' | 'bad-payload' | 'bad-settings';

function buildCommand(
  type: CommandType,
  requestId: string,
  data: JsonObject,
  payload: JsonObject,
): ClientCommand | Failure {
  switch (type) {
    case 'authenticate': {
      const resumeToken = payload['resumeToken'];
      if (!hasExactKeys(payload, ['resumeToken']) || !isResumeToken(resumeToken)) return 'bad-payload';
      return envelope(type, requestId, { resumeToken });
    }
    case 'update-settings': {
      const expected = payload['expectedSettingsRevision'];
      if (!hasExactKeys(payload, ['expectedSettingsRevision', 'settings']) || !isRevision(expected)) {
        return 'bad-payload';
      }
      const settings = parseSettings(payload['settings']);
      if (typeof settings === 'string') return settings;
      return envelope(type, requestId, { expectedSettingsRevision: expected, settings });
    }
    case 'ready': {
      const expected = revisionPayload(payload);
      return expected === null ? 'bad-payload' : envelope(type, requestId, { expectedSettingsRevision: expected });
    }
    case 'submit-choice': {
      const matchId = data['matchId'];
      const roundId = data['roundId'];
      if (!isIdentifier(matchId) || !isRoundId(roundId)) return 'bad-envelope';
      const element = payload['element'];
      if (!hasExactKeys(payload, ['element']) || !isElement(element)) return 'bad-payload';
      return Object.freeze({ ...envelope(type, requestId, { element }), matchId, roundId });
    }
    case 'rematch-ready': {
      const matchId = data['matchId'];
      if (!isIdentifier(matchId)) return 'bad-envelope';
      const expected = revisionPayload(payload);
      if (expected === null) return 'bad-payload';
      return Object.freeze({ ...envelope(type, requestId, { expectedSettingsRevision: expected }), matchId });
    }
    case 'leave':
    case 'ping':
      return hasExactKeys(payload, []) ? envelope(type, requestId, {}) : 'bad-payload';
  }
}

/** Forme stricte (INVALID_MESSAGE) puis règle métier du domaine (INVALID_SETTINGS : X entier de 1 à 10). */
function parseSettings(value: unknown): MatchSettings | Failure {
  if (!isJsonObject(value) || !hasExactKeys(value, ['target', 'drawEnabled'])) return 'bad-payload';
  const target = value['target'];
  const drawEnabled = value['drawEnabled'];
  if (typeof target !== 'number' || typeof drawEnabled !== 'boolean') return 'bad-payload';
  if (!Number.isInteger(target) || target < TARGET_MIN || target > TARGET_MAX) return 'bad-settings';
  return Object.freeze({ target, drawEnabled });
}

function revisionPayload(payload: JsonObject): number | null {
  const expected = payload['expectedSettingsRevision'];
  return hasExactKeys(payload, ['expectedSettingsRevision']) && isRevision(expected) ? expected : null;
}

function envelope<T extends CommandType, P extends object>(type: T, requestId: string, payload: P) {
  return Object.freeze({ v: PROTOCOL_VERSION, type, requestId, payload: Object.freeze(payload) });
}

function isCommandType(value: unknown): value is CommandType {
  return typeof value === 'string' && (COMMAND_TYPES as readonly string[]).includes(value);
}

function reject(code: ParseRejection['code'], reason: RejectReason, requestId?: string): ParseRejection {
  return Object.freeze(
    requestId === undefined ? { ok: false, code, reason } : { ok: false, code, reason, requestId },
  );
}
