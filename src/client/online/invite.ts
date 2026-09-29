import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, normalizeRoomCode } from '../../shared/protocol/index.ts';

/** Séparateur d'affichage du code (maquette « K7F·2QX »), jamais transmis au serveur. */
export const CODE_SEPARATOR = '·';

/** Chemin d'une invitation : il ne porte que le code de la room, jamais le token de reprise (D39). */
const INVITE_PATH = /^\/p\/([^/?#]+)\/?$/;

/** Code canonique groupé 4·4 pour la lecture et la dictée. */
export function formatCode(code: string): string {
  const half = ROOM_CODE_LENGTH / 2;
  return `${code.slice(0, half)}${CODE_SEPARATOR}${code.slice(half)}`;
}

/** Lien d'invitation partagé par l'hôte : l'origine de la page et le code, rien d'autre. */
export function inviteLink(code: string, origin: string = window.location.origin): string {
  return `${origin}/p/${code}`;
}

/** Code d'un chemin d'invitation `/p/CODE` ; `null` si le chemin n'en est pas un ou si le code ne peut exister. */
export function codeFromPath(pathname: string): string | null {
  const match = INVITE_PATH.exec(pathname);
  if (!match?.[1]) return null;
  let raw: string;
  try {
    raw = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return normalizeRoomCode(raw);
}

export type CodeInputError = 'empty' | 'incomplete' | 'invalid-character' | 'too-long';

export type CodeInput = { readonly ok: true; readonly code: string } | { readonly ok: false; readonly error: CodeInputError };

/** Tout caractère hors de l'alphabet des codes (dont I, O, 0 et 1, exclus pour la dictée). */
const FORBIDDEN = new RegExp(`[^${ROOM_CODE_ALPHABET}]`);

/**
 * Saisie du code reçu : espaces, tirets et séparateurs ignorés, casse indifférente. Un lien
 * d'invitation collé tel quel donne son code. Les caractères absents de l'alphabet (I, O, 0, 1…)
 * sont signalés comme tels, sans jamais être corrigés en silence.
 */
export function codeFromInput(text: string): CodeInput {
  const fromLink = codeFromLink(text);
  if (fromLink !== null) return { ok: true, code: fromLink };
  const compact = text.toUpperCase().replace(/[\s·.\-_]/g, '');
  if (compact === '') return { ok: false, error: 'empty' };
  if (FORBIDDEN.test(compact)) return { ok: false, error: 'invalid-character' };
  if (compact.length < ROOM_CODE_LENGTH) return { ok: false, error: 'incomplete' };
  if (compact.length > ROOM_CODE_LENGTH) return { ok: false, error: 'too-long' };
  return { ok: true, code: compact };
}

/** Texte collé : lien d'invitation complet (toute origine) ou chemin `/p/CODE`. */
function codeFromLink(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.includes('/p/')) return null;
  try {
    return codeFromPath(new URL(trimmed, 'http://invite.local').pathname);
  } catch {
    return null;
  }
}
