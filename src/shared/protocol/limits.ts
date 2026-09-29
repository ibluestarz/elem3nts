/** Version unique du contrat réseau ; toute autre valeur reçue est refusée (`VERSION_UNSUPPORTED`). */
export const PROTOCOL_VERSION = 1;

/** Taille maximale d'une trame texte, en octets UTF-8 (PROTOCOL « Idempotence et validation »). */
export const MAX_MESSAGE_BYTES = 4096;

/** Alphabet des codes de room : ni 0/O, ni 1/I, pour une dictée sans ambiguïté. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 8;

/** Longueur maximale des identifiants techniques (`requestId`, `matchId`). */
export const MAX_ID_LENGTH = 64;

const ROOM_CODE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${String(ROOM_CODE_LENGTH)}}$`);
const IDENTIFIER = new RegExp(`^[A-Za-z0-9_-]{1,${String(MAX_ID_LENGTH)}}$`);
/**
 * 256 bits en base64url sans remplissage : 43 caractères, dont le dernier ne porte que 4 bits
 * (ses 2 bits de poids faible sont nuls). Toute autre forme ne peut pas être un token émis.
 */
const RESUME_TOKEN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

/** Code saisi par un joueur : espaces de bord retirés, majuscules ; `null` s'il ne peut pas exister. */
export function normalizeRoomCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return ROOM_CODE.test(code) ? code : null;
}

/** Code de room déjà canonique (forme transmise par le serveur). */
export function isRoomCode(value: unknown): value is string {
  return typeof value === 'string' && ROOM_CODE.test(value);
}

export function isResumeToken(value: unknown): value is string {
  return typeof value === 'string' && RESUME_TOKEN.test(value);
}

/** `requestId` et `matchId` : 1 à 64 caractères `[A-Za-z0-9_-]`, jamais de texte libre renvoyé tel quel. */
export function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

/** Révisions et `settingsRevision` : entiers sûrs ≥ 0. */
export function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** `roundId` : entier sûr ≥ 1, numéroté dans la partie. */
export function isRoundId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

/** Instant serveur absolu en millisecondes (epoch) : entier sûr ≥ 0. */
export function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/**
 * Taille UTF-8 d'une chaîne sans l'encoder, arrêtée dès que `limit` est dépassée. Un surrogate
 * isolé compte 3 octets, comme U+FFFD produit par `TextEncoder`.
 */
export function utf8ByteLength(text: string, limit = Number.POSITIVE_INFINITY): number {
  let bytes = 0;
  for (let index = 0; index < text.length && bytes <= limit; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && isLowSurrogate(text.charCodeAt(index + 1))) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}
