import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../shared/protocol/index.ts';

/** Taille du token de reprise : 32 octets, soit 256 bits (PROTOCOL « Transport et entrée dans une room »). */
const TOKEN_BYTES = 32;

/**
 * Code de room aléatoire (CSPRNG). L'alphabet a 32 symboles : `octet % 32` garde exactement
 * 5 bits uniformes, sans biais de modulo (256 est un multiple de 32). 40 bits par code.
 */
export function generateRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET.charAt(byte % ROOM_CODE_ALPHABET.length)).join('');
}

/** Token de reprise : 256 bits aléatoires en base64url sans remplissage (43 caractères). */
export function generateResumeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/**
 * Empreinte persistée à la place du token : SHA-256 en hexadécimal. Un token porte 256 bits
 * d'entropie : aucune dérivation lente ni sel n'ajoute de résistance à la recherche exhaustive.
 */
export async function hashResumeToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
