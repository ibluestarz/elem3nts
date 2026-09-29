import {
  EMPTY_SELECTION,
  cancelMatch,
  lockChoice,
  playRound,
  settleMatch,
  startMatch,
  type PlayerIndex,
} from '../domain/index.ts';
import { CYCLE_MS, MATCH_INTRO_MS, roundFollowUp, roundResultMs } from '../shared/cycle.ts';
import type {
  LeaveCommand,
  ReadyCommand,
  RematchReadyCommand,
  SubmitChoiceCommand,
  UpdateSettingsCommand,
} from '../shared/protocol/index.ts';
import { MAX_REPLIES, type PersistedRoom, type Replies, type Reply } from './codec.ts';
import { recordActivity } from './expiry.ts';

/**
 * Machine de jeu d'une room (PFC-014) : règles pures, sans horloge ni stockage, comme `reservations.ts`.
 * La room (`room.ts`) fournit `now`, persiste le résultat (point de linéarisation), publie, puis
 * replanifie son alarme. Chaque fonction rend la room suivante (révision + 1) ou `null` si rien ne
 * change : aucune écriture, aucune révision consommée.
 *
 * Chronologie (D09, `shared/cycle.ts`) : `starting` (ouverture) → `selecting` (5 s) → `round-result`
 * (révélation, effet, résultat, pause) → `selecting` … ou `match-ended` (trophées réglés une fois).
 * Chaque échéance suivante part de l'instant de traitement : une alarme en retard n'écourte jamais la
 * fenêtre suivante et ne rattrape pas plusieurs manches en rafale (D31).
 */

/** Commandes de jeu qui modifient la room, une fois autorisées par `authorizeCommand`. */
export type GameCommand = UpdateSettingsCommand | ReadyCommand | SubmitChoiceCommand | RematchReadyCommand;

/** Commandes dont la réponse est mémorisée pour le dédoublonnage (`leave` compris, bien qu'il efface la room). */
export type ReplayableCommand = GameCommand | LeaveCommand;

export function isReplayable(command: { readonly type: string }): command is ReplayableCommand {
  return (
    command.type === 'update-settings' ||
    command.type === 'ready' ||
    command.type === 'submit-choice' ||
    command.type === 'rematch-ready' ||
    command.type === 'leave'
  );
}

/**
 * Effet d'une commande déjà autorisée (phase, place, hôte, manche et révision des réglages vérifiés).
 * `null` : commande sans effet (même réglages, confirmation déjà donnée), acquittée sans écriture.
 */
export function applyCommand(room: PersistedRoom, slot: PlayerIndex, command: GameCommand, now: number): PersistedRoom | null {
  const next = transition(room, slot, command, now);
  // Toute commande acceptée qui modifie la room est une activité utile (D16) ; une commande sans effet non.
  return next === null ? null : recordActivity(next, now);
}

function transition(room: PersistedRoom, slot: PlayerIndex, command: GameCommand, now: number): PersistedRoom | null {
  switch (command.type) {
    case 'update-settings': {
      const { target, drawEnabled } = command.payload.settings;
      if (target === room.settings.target && drawEnabled === room.settings.drawEnabled) return null;
      // Toute modification retire les confirmations des deux joueurs (SPEC, PROTOCOL).
      return {
        ...room,
        revision: room.revision + 1,
        settings: { target, drawEnabled },
        settingsRevision: room.settingsRevision + 1,
        ready: [false, false],
      };
    }
    case 'ready':
    case 'rematch-ready':
      return confirm(room, slot, now);
    case 'submit-choice': {
      // Premier choix verrouillé (D08) ; l'échéance n'est jamais avancée par un choix.
      const lock = lockChoice(room.selection, slot, command.payload.element);
      return lock.locked ? { ...room, revision: room.revision + 1, selection: lock.selection } : null;
    }
  }
}

/**
 * Fermeture de la room, par départ d'un joueur (`leave`) ou échéance de fin de vie (`expiry.ts` : délai
 * de reconnexion D15, durée maximale ou inactivité D16) : partie en cours annulée sans trophée (R09) ;
 * une partie déjà réglée le reste, et une partie décidée mais pas encore réglée (pause pendant le dernier
 * résultat) n'est jamais réglée. Plus aucune échéance ni confirmation.
 */
export function closeRoom(room: PersistedRoom): PersistedRoom {
  return {
    ...room,
    revision: room.revision + 1,
    phase: 'closed',
    resumePhase: null,
    resumeRemainingMs: null,
    reconnectDeadline: null,
    match: room.match === null ? null : cancelMatch(room.match),
    ready: [false, false],
    deadline: null,
  };
}

/**
 * Traite l'échéance de jeu due à `now` (échéance ≤ `now` : une commande arrivée à l'instant exact est
 * trop tardive), une seule transition par appel. Idempotente : une fois traitée, l'échéance suivante
 * est dans le futur, et une alarme répétée ne change plus rien.
 */
export function advanceGame(room: PersistedRoom, now: number): PersistedRoom | null {
  const { match, deadline } = room;
  if (match === null || deadline === null || now < deadline) return null;
  switch (room.phase) {
    case 'starting':
      return { ...room, revision: room.revision + 1, phase: 'selecting', deadline: now + CYCLE_MS.selection };
    case 'selecting': {
      const { roundId } = room;
      if (roundId === null) return null;
      // Résolution unique à l'échéance, avec le moteur partagé : choix manquants compris (R11, R12).
      const play = playRound(match, room.selection);
      return {
        ...room,
        revision: room.revision + 1,
        phase: 'round-result',
        match: play.match,
        lastRound: { roundId, choices: room.selection, resolution: play.round },
        deadline: now + roundResultMs(play.round.kind, roundFollowUp(play.match)),
      };
    }
    case 'round-result': {
      if (roundFollowUp(match) === 'end') return endMatch(room, match);
      return {
        ...room,
        revision: room.revision + 1,
        phase: 'selecting',
        roundId: (room.roundId ?? 0) + 1,
        selection: EMPTY_SELECTION,
        deadline: now + CYCLE_MS.selection,
      };
    }
    case 'lobby':
    case 'match-ended':
    case 'paused':
    case 'closed':
      // Pause : l'échéance publiée est celle de la reconnexion (`expiry.ts`) ; la phase attend.
      return null;
  }
}

/**
 * Échéance que l'alarme unique doit couvrir pour cette machine : celle de la phase chronométrée, `null`
 * sinon. Une pause n'a que l'échéance de reconnexion, couverte avec les autres fins de vie (`expiry.ts`).
 */
export function nextGameDeadline(room: PersistedRoom): number | null {
  return room.phase === 'starting' || room.phase === 'selecting' || room.phase === 'round-result' ? room.deadline : null;
}

/** Réponse déjà rendue à cette place pour ce `requestId`, ou `null`. */
export function findReply(room: PersistedRoom, slot: PlayerIndex, requestId: string): Reply | null {
  return room.replies[slot].find((reply) => reply.requestId === requestId) ?? null;
}

/**
 * Mémorise la réponse d'une commande acceptée dans la transition même qu'elle produit (`next`) : les
 * deux sont persistées ensemble ou pas du tout. Les plus anciennes sortent au-delà de `MAX_REPLIES` ;
 * au-delà, les gardes de phase, de verrou et de manche empêchent seules un second effet.
 */
export function withReply(next: PersistedRoom, slot: PlayerIndex, requestId: string): PersistedRoom {
  const kept = [...next.replies[slot], { requestId, revision: next.revision }].slice(-MAX_REPLIES);
  const replies: Replies = slot === 0 ? [kept, next.replies[1]] : [next.replies[0], kept];
  return { ...next, replies };
}

/**
 * Confirmation d'un joueur (prêt au lobby, revanche en fin de partie). La seconde lance la partie, mais
 * jamais avec un absent (PROTOCOL) : elle reste alors enregistrée jusqu'au retour de l'autre joueur.
 */
function confirm(room: PersistedRoom, slot: PlayerIndex, now: number): PersistedRoom | null {
  if (room.ready[slot]) return null;
  const ready: readonly [boolean, boolean] = slot === 0 ? [true, room.ready[1]] : [room.ready[0], true];
  if (!(ready[0] && ready[1] && room.connected[0] && room.connected[1])) {
    return { ...room, revision: room.revision + 1, ready };
  }
  const revision = room.revision + 1;
  return {
    ...room,
    revision,
    phase: 'starting',
    // Identifiant unique dans la room : la révision de la transition qui lance la partie.
    match: startMatch(`m-${String(revision)}`, room.settings),
    roundId: 1,
    selection: EMPTY_SELECTION,
    lastRound: null,
    ready: [false, false],
    deadline: now + MATCH_INTRO_MS,
  };
}

/** Fin de partie après son dernier résultat : trophées réglés une seule fois par matchId (R09, R10, D26). */
function endMatch(room: PersistedRoom, match: NonNullable<PersistedRoom['match']>): PersistedRoom {
  const session = { trophies: room.trophies, settledMatchIds: room.settledMatchId === null ? [] : [room.settledMatchId] };
  const settlement = settleMatch(session, match);
  return {
    ...room,
    revision: room.revision + 1,
    phase: 'match-ended',
    trophies: settlement.session.trophies,
    settledMatchId: match.id,
    ready: [false, false],
    deadline: null,
  };
}
