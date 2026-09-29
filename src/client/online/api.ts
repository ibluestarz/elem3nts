import { parseRoomEntry, type RoomEntry } from '../../shared/protocol/index.ts';

/**
 * Motifs d'échec d'une entrée dans une room (PROTOCOL « Entrée HTTP ») :
 * - `ROOM_UNAVAILABLE` : code inconnu, expiré ou fermé (404), ou room illisible (503) ;
 * - `ROOM_FULL` : les deux places sont prises (409) ;
 * - `CODE_COLLISION` : création impossible pour l'instant, réessayable (503) ;
 * - `RATE_LIMITED` : trop de créations ou jonctions depuis cette adresse, réessayable après une minute (429, PFC-020) ;
 * - `network` : aucune réponse (hors ligne, serveur injoignable, délai dépassé) ;
 * - `server` : toute autre réponse inattendue, y compris une réponse de succès mal formée.
 */
export type EntryFailure = 'ROOM_UNAVAILABLE' | 'ROOM_FULL' | 'CODE_COLLISION' | 'RATE_LIMITED' | 'network' | 'server';

export type EntryResult =
  | { readonly ok: true; readonly entry: RoomEntry }
  | { readonly ok: false; readonly failure: EntryFailure }
  | { readonly ok: false; readonly failure: 'aborted' };

/** Au-delà, la requête est abandonnée et signalée comme un problème réseau. */
export const ENTRY_TIMEOUT_MS = 10_000;

const KNOWN_CODES: readonly EntryFailure[] = ['ROOM_UNAVAILABLE', 'ROOM_FULL', 'CODE_COLLISION', 'RATE_LIMITED'];

/** Crée une room et réserve la place de Joueur 1 (`POST /api/rooms`). */
export function createRoom(signal: AbortSignal): Promise<EntryResult> {
  return enter('/api/rooms', 201, signal);
}

/** Réserve la place de Joueur 2 d'une room existante (`POST /api/rooms/:code/join`), code déjà canonique. */
export function joinRoom(code: string, signal: AbortSignal): Promise<EntryResult> {
  return enter(`/api/rooms/${encodeURIComponent(code)}/join`, 200, signal);
}

async function enter(path: string, expected: number, signal: AbortSignal): Promise<EntryResult> {
  // `AbortSignal.any` n'existe qu'à partir de Chrome 116 (cible D21 : Chrome 109) : liaison manuelle.
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
  };
  signal.addEventListener('abort', abort, { once: true });
  const timer = window.setTimeout(abort, ENTRY_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      // Aucun corps : le serveur n'en lit pas (D36). Réponse `no-store` côté serveur.
      response = await fetch(path, { method: 'POST', credentials: 'same-origin', signal: controller.signal });
    } catch {
      return signal.aborted ? { ok: false, failure: 'aborted' } : { ok: false, failure: 'network' };
    }
    const body = await readJson(response);
    if (signal.aborted) return { ok: false, failure: 'aborted' };
    if (response.status === expected) {
      const entry = parseRoomEntry(body);
      return entry === null ? { ok: false, failure: 'server' } : { ok: true, entry };
    }
    return { ok: false, failure: failureOf(body) };
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

/** Corps JSON d'une réponse, `null` s'il est absent ou illisible (jamais d'exception). */
async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/** Code d'erreur public `{ error: { code } }` ; seuls les codes attendus du client sont retenus. */
function failureOf(body: unknown): EntryFailure {
  if (typeof body !== 'object' || body === null) return 'server';
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return 'server';
  const code = (error as { code?: unknown }).code;
  return KNOWN_CODES.find((known) => known === code) ?? 'server';
}
