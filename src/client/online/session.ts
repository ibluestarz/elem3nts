import { parseRoomEntry, type RoomEntry } from '../../shared/protocol/index.ts';

/**
 * Place en ligne de cet onglet (PFC-017, PROTOCOL « Transport ») : code, place et token de reprise,
 * gardés en `sessionStorage`, donc propres à l'onglet et oubliés à sa fermeture. Ils ne servent qu'à
 * reprendre la place après un rechargement ; ils sont retirés dès que la room est quittée, fermée ou
 * refusée. Jamais dans l'URL, le DOM ni un journal. Stockage indisponible (navigation privée, quota,
 * refus) : la reprise après rechargement est seulement perdue, le jeu continue.
 */
const KEY = 'elem3nts.room.v1';

export function saveSession(entry: RoomEntry): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ roomCode: entry.roomCode, slot: entry.slot, resumeToken: entry.resumeToken }));
  } catch {
    // Stockage refusé : pas de reprise après rechargement, sans autre effet.
  }
}

/** Place mémorisée par cet onglet, validée comme une réponse d'entrée (clés exactes, token 256 bits) ; sinon `null`. */
export function loadSession(): RoomEntry | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const entry = parseRoomEntry(JSON.parse(raw));
    // Valeur altérée ou d'un autre format : effacée plutôt que relue à chaque chargement.
    if (entry === null) window.sessionStorage.removeItem(KEY);
    return entry;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Stockage indisponible : rien n'y a été écrit.
  }
}
