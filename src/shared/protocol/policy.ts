import type { PlayerIndex } from '../../domain/index.ts';
import type { ClientCommand } from './commands.ts';
import type { ErrorCode } from './errors.ts';
import type { RoomView } from './state.ts';

export type Authorization = { readonly ok: true } | { readonly ok: false; readonly code: ErrorCode };

const ALLOWED: Authorization = Object.freeze({ ok: true });

/**
 * Contexte autorisé d'une commande déjà validée (tableau de PROTOCOL). Fonction pure : elle ne
 * modifie ni la room ni la commande et ne décide aucun effet ; le serveur (PFC-013/014) applique la
 * transition seulement si elle renvoie `ok`. `slot` vient de la socket authentifiée, `null` avant.
 *
 * Ordre des gardes : room fermée → authentification → hôte → partie/manche visée → phase → verrou
 * ou révision des réglages. Une requête qui vise une autre partie ou manche est donc `STALE_ROUND`
 * même si la phase a changé depuis, ce qui est le diagnostic le plus utile au client.
 */
export function authorizeCommand(command: ClientCommand, room: RoomView, slot: PlayerIndex | null): Authorization {
  if (room.phase === 'closed') return deny('ROOM_UNAVAILABLE');
  if (slot === null) return command.type === 'authenticate' ? ALLOWED : deny('UNAUTHORIZED');

  switch (command.type) {
    case 'authenticate':
      // Une socket authentifiée ne change jamais de place ; une reprise ouvre une nouvelle socket.
      return deny('INVALID_PHASE');
    case 'ping':
    case 'leave':
      return ALLOWED;
    case 'update-settings':
      if (slot !== 0) return deny('NOT_HOST');
      if (room.phase !== 'lobby' && room.phase !== 'match-ended') return deny('INVALID_PHASE');
      return settingsRevision(command.payload.expectedSettingsRevision, room);
    case 'ready':
      if (room.phase !== 'lobby' || !room.connected[0] || !room.connected[1]) return deny('INVALID_PHASE');
      return settingsRevision(command.payload.expectedSettingsRevision, room);
    case 'submit-choice':
      if (room.match === null) return deny('INVALID_PHASE');
      if (command.matchId !== room.match.id || command.roundId !== room.roundId) return deny('STALE_ROUND');
      if (room.phase !== 'selecting') return deny('INVALID_PHASE');
      return room.selection[slot] === null ? ALLOWED : deny('CHOICE_LOCKED');
    case 'rematch-ready':
      if (room.match !== null && command.matchId !== room.match.id) return deny('STALE_ROUND');
      if (room.phase !== 'match-ended') return deny('INVALID_PHASE');
      return settingsRevision(command.payload.expectedSettingsRevision, room);
  }
}

function settingsRevision(expected: number, room: RoomView): Authorization {
  return expected === room.settingsRevision ? ALLOWED : deny('STALE_SETTINGS');
}

function deny(code: ErrorCode): Authorization {
  return Object.freeze({ ok: false, code });
}
