import { evaluateMatch, type Element, type PlayerIndex, type Scores } from '../../domain/index.ts';
import { CYCLE_MS, clashDelays, revealDelay, roundFollowUp, roundResultMs, type RoundFollowUp } from '../../shared/cycle.ts';
import type { PublicMatchResult, PublicRoundResult, PublicState } from '../../shared/protocol/index.ts';
import { OPENING_TITLE, SUDDEN_BANNER, pointsLine, roundBanner, type Banner, type PlayerNames } from '../copy.ts';
import { ELEMENT_NAMES, PLAYER_NAMES } from '../input/keys.ts';
import type { SceneView } from '../scene/commands.ts';
import { NO_STATUS, type ArenaModel, type HudStatus } from '../screens/arenaModel.ts';
import type { Phase } from '../state/game.ts';
import { toLocalTime } from './serverClock.ts';

/**
 * Partie en ligne vue par un client (PFC-016). Le serveur décide seul phases, échéances, scores,
 * résultats et trophées ; ce module ne fait que les présenter :
 * - **de son côté** : soi à gauche (« Vous »), l'adversaire à droite, comme la maquette (`names`) ;
 * - **au bon moment** : la chronologie d'une manche (révélation, effet, impact, résultat) est celle
 *   du mode local (D09), calée sur l'échéance publiée par le serveur (`shared/cycle.ts`). Aucune
 *   résolution n'est calculée ici : le résultat vient du `state` ; l'horloge locale ne fait que
 *   choisir lequel des moments déjà publiés montrer.
 */

/** Paire vue de sa place : indice 0 = soi (gauche), 1 = l'adversaire (droite). */
export function fromMySide<T>(pair: readonly [T, T], slot: PlayerIndex): readonly [T, T] {
  return slot === 0 ? pair : [pair[1], pair[0]];
}

/** Place vue de son côté : 0 = soi, 1 = l'adversaire. */
export const sideOf = (player: PlayerIndex, slot: PlayerIndex): PlayerIndex => (player === slot ? 0 : 1);

export const opponentOf = (slot: PlayerIndex): PlayerIndex => (slot === 0 ? 1 : 0);

/** Noms affichés : « Vous », puis l'adversaire par sa place (D18, sans pseudonyme). */
export const onlineNames = (slot: PlayerIndex): PlayerNames => ['Vous', PLAYER_NAMES[opponentOf(slot)]];

/** Phases serveur montrées dans l'arène ; le lobby garde son panneau, la fin son écran. */
export function isArenaPhase(state: PublicState): boolean {
  return state.phase === 'starting' || state.phase === 'selecting' || state.phase === 'round-result' || state.phase === 'paused';
}

/** Choix envoyé par ce client pour une manche : rendu à soi seul, jamais reçu du serveur avant révélation. */
export interface OwnPick {
  readonly matchId: string;
  readonly roundId: number;
  readonly element: Element;
}

/** Choix de ce client pour la manche courante du `state`, s'il en a envoyé un. */
export function currentPick(pick: OwnPick | null, state: PublicState): Element | null {
  return pick !== null && pick.matchId === state.matchId && pick.roundId === state.roundId ? pick.element : null;
}

/** Suite d'une manche résolue, d'après les scores publiés : même règle que le serveur (`roundFollowUp`). */
export function followUpOf(state: Pick<PublicState, 'scores' | 'settings'>): RoundFollowUp {
  const { scores, settings } = state;
  return roundFollowUp({ id: 'public', settings, scores, result: evaluateMatch(scores, settings) });
}

/** Scores d'avant la manche révélée : les deltas publiés sont effectifs (D25), `après − delta` est exact. */
export function scoresBefore(scores: Scores, result: PublicRoundResult): Scores {
  return [scores[0] - result.delta[0], scores[1] - result.delta[1]];
}

/** Moment affiché et instant local (ms) où il commence ; le premier commence toujours. */
export interface Segment {
  readonly phase: Phase;
  readonly start: number;
}

/**
 * Moments d'un `state`, sur l'horloge locale (`offset` : décalage serveur − local) :
 * - `starting` : bannière d'ouverture, puis attente 0,4 s avant l'échéance (D38) ;
 * - `selecting` : un seul moment ; le décompte peut atteindre zéro, la révélation attend le serveur ;
 * - `round-result` : révélation, effet, impact et résultat, puis fermeture, mort subite ou pause, à
 *   partir de l'instant de révélation `deadline − roundResultMs` (PROTOCOL « Transitions ») ;
 * - `match-ended` : écran de fin ; `paused` : attente (reprise : PFC-017).
 */
export function timelineOf(state: PublicState, offset: number): readonly Segment[] {
  const always = (phase: Phase): readonly Segment[] => [{ phase, start: -Infinity }];
  switch (state.phase) {
    case 'starting':
      if (state.deadline === undefined) return always('intro');
      return [
        { phase: 'intro', start: -Infinity },
        { phase: 'ready', start: toLocalTime(state.deadline, offset) - CYCLE_MS.ready },
      ];
    case 'selecting':
      return always('selecting');
    case 'round-result': {
      const { result, deadline } = state;
      if (result === undefined || deadline === undefined) return always('pause');
      const followUp = followUpOf(state);
      const reveal = toLocalTime(deadline, offset) - roundResultMs(result.kind, followUp);
      const clash = reveal + revealDelay(result.kind);
      const { toImpact, afterImpact } = clashDelays(result.kind);
      const impact = clash + toImpact;
      const after = impact + afterImpact;
      const tail: readonly Segment[] =
        followUp === 'end'
          ? [{ phase: 'closing', start: after }]
          : followUp === 'sudden'
            ? [
                { phase: 'sudden', start: after },
                { phase: 'pause', start: after + CYCLE_MS.sudden },
              ]
            : [{ phase: 'pause', start: after }];
      return [
        { phase: 'reveal', start: -Infinity },
        { phase: 'clash', start: clash },
        { phase: 'result', start: impact },
        ...tail,
      ];
    }
    case 'match-ended':
      return always('ended');
    case 'paused':
    case 'lobby':
    case 'closed':
      return always('pause');
  }
}

/** Moment affiché à l'instant local `now`. */
export function phaseAt(timeline: readonly Segment[], now: number): Phase {
  let phase: Phase = timeline[0]?.phase ?? 'pause';
  for (const segment of timeline) if (segment.start <= now) phase = segment.phase;
  return phase;
}

/**
 * Manche dont le résultat a ouvert la mort subite (égalité au-delà de X, nul OFF) : la mention reste
 * affichée jusqu'à la fin de la partie, comme en local, à partir de sa bannière.
 */
export interface SuddenMark {
  readonly matchId: string;
  readonly roundId: number;
}

export function suddenMarkOf(state: PublicState): SuddenMark | null {
  if (state.phase !== 'round-result' || state.matchId === null || state.roundId === null) return null;
  return followUpOf(state) === 'sudden' ? { matchId: state.matchId, roundId: state.roundId } : null;
}

function isSudden(mark: SuddenMark | null, state: PublicState, phase: Phase): boolean {
  if (mark?.matchId !== state.matchId || state.roundId === null) return false;
  return state.roundId > mark.roundId || (state.roundId === mark.roundId && (phase === 'sudden' || phase === 'pause'));
}

const REVEALED_PHASES: ReadonlySet<Phase> = new Set(['reveal', 'clash', 'result']);

function statusesOf(state: PublicState, phase: Phase, pick: Element | null): readonly [HudStatus, HudStatus] {
  const { yourSlot: slot } = state;
  if (phase === 'selecting') {
    const [mine, theirs] = fromMySide(state.choiceLocked, slot);
    // Son propre choix est connu de soi seul (maquette : « Choix verrouillé · Feu ») ; celui de l'adversaire jamais.
    const own: HudStatus =
      pick !== null
        ? { text: `Choix verrouillé · ${ELEMENT_NAMES[pick]}`, tone: 'locked' }
        : mine
          ? { text: 'Choix verrouillé', tone: 'locked' }
          : { text: 'Choix en cours…', tone: null };
    const other: HudStatus = theirs ? { text: 'Choix verrouillé', tone: 'locked' } : { text: 'Réfléchit…', tone: null };
    return [own, other];
  }
  if (REVEALED_PHASES.has(phase) && state.revealedChoices) {
    const choices = fromMySide(state.revealedChoices, slot);
    const view = (element: Element | null): HudStatus =>
      element ? { text: ELEMENT_NAMES[element], tone: element } : { text: 'Aucun choix', tone: null };
    return [view(choices[0]), view(choices[1])];
  }
  return [NO_STATUS, NO_STATUS];
}

/** Résultat publié, exprimé de son côté (gagnant et scores d'avant). */
function sideResult(state: PublicState, result: PublicRoundResult) {
  const { yourSlot: slot } = state;
  return {
    kind: result.kind,
    winner: result.winner === null ? null : sideOf(result.winner, slot),
    before: fromMySide(scoresBefore(state.scores, result), slot),
    delta: fromMySide(result.delta, slot),
  };
}

function announcementOf(state: PublicState, phase: Phase, names: PlayerNames, pick: Element | null, banner: Banner | null): string {
  const round = String(state.roundId ?? 1);
  if (phase === 'selecting') {
    const [mine, theirs] = fromMySide(state.choiceLocked, state.yourSlot);
    const self = pick !== null || mine;
    if (self && theirs) return `Vous et ${names[1]} avez verrouillé vos choix.`;
    if (self) return pick === null ? 'Vous avez verrouillé votre choix.' : `Vous avez verrouillé votre choix : ${ELEMENT_NAMES[pick]}.`;
    if (theirs) return `${names[1]} a verrouillé son choix.`;
    return `Manche ${round} : choisissez.`;
  }
  if (phase === 'result' && banner && state.revealedChoices) {
    const choices = fromMySide(state.revealedChoices, state.yourSlot);
    const scores = fromMySide(state.scores, state.yourSlot);
    const picks = ([0, 1] as const)
      .map((side) => {
        const element = choices[side];
        return `${names[side]} : ${element ? ELEMENT_NAMES[element] : 'aucun choix'}`;
      })
      .join(', ');
    return `${picks}. ${banner.title} — ${banner.sub}. Score ${String(scores[0])} à ${String(scores[1])}.`;
  }
  if (phase === 'sudden') return `${SUDDEN_BANNER.title} : ${SUDDEN_BANNER.sub}.`;
  return '';
}

export interface OnlineArenaInput {
  readonly state: PublicState;
  /** Moment affiché (`phaseAt`). */
  readonly phase: Phase;
  /** Décalage serveur − local ; les échéances du serveur sont converties sur l'horloge locale. */
  readonly offset: number;
  readonly pick: OwnPick | null;
  readonly sudden: SuddenMark | null;
}

/** Arène d'un client en ligne, entièrement dérivée du dernier `state` accepté. */
export function onlineArenaModel({ state, phase, offset, pick, sudden }: OnlineArenaInput): ArenaModel {
  const slot = state.yourSlot;
  const names = onlineNames(slot);
  const own = currentPick(pick, state);
  const result = state.phase === 'round-result' && state.result ? sideResult(state, state.result) : null;
  const beforeImpact = phase === 'reveal' || phase === 'clash';
  const banner: Banner | null =
    phase === 'intro'
      ? { title: OPENING_TITLE, sub: pointsLine(state.settings.target) }
      : phase === 'result' && result
        ? roundBanner(result, names)
        : phase === 'sudden'
          ? SUDDEN_BANNER
          : null;
  return {
    phase,
    names,
    // Scores d'avant pendant la révélation et l'effet, comme en local ; jamais de score calculé ici.
    scores: beforeImpact && result ? result.before : fromMySide(state.scores, slot),
    deltas: phase === 'result' && result ? result.delta : null,
    statuses: statusesOf(state, phase, own),
    round: state.roundId ?? 1,
    target: state.settings.target,
    sudden: isSudden(sudden, state, phase),
    deadline: state.phase === 'selecting' && state.deadline !== undefined ? toLocalTime(state.deadline, offset) : null,
    banner,
    announcement: announcementOf(state, phase, names, own, banner),
  };
}

/** Titre et sous-titre de fin (maquette `endTitle`/`endSub` en ligne : Victoire, Défaite, Match nul). */
export function verdictOf(result: PublicMatchResult, slot: PlayerIndex): { readonly title: string; readonly sub: string } {
  if (result.status === 'draw') return { title: 'Match nul', sub: 'Les deux joueurs atteignent la cible ensemble' };
  if (result.winner === slot) return { title: 'Victoire', sub: 'Vous remportez la partie' };
  return { title: 'Défaite', sub: `${PLAYER_NAMES[result.winner]} remporte la partie` };
}

/** Trophée de la partie terminée, de son côté : le vainqueur, ou les deux pour un nul (R09). */
export function trophiesWonOf(result: PublicMatchResult, slot: PlayerIndex): readonly [boolean, boolean] {
  if (result.status === 'draw') return [true, true];
  return fromMySide([result.winner === 0, result.winner === 1], slot);
}

/**
 * Projection de la partie pour la scène 3D, de son côté (soi à gauche) : verrous seulement pendant la
 * sélection, éléments et effet une fois révélés par le serveur, célébration à la fin (comme en local).
 */
export function onlineSceneView(state: PublicState | null, phase: Phase, pick: OwnPick | null): SceneView {
  const inGame = state !== null && (isArenaPhase(state) || state.phase === 'match-ended');
  if (!inGame) {
    return { screen: 'home', phase: 'intro', matchId: null, round: 0, locked: [false, false], revealed: null, clash: null, celebrate: null };
  }
  const slot = state.yourSlot;
  const [mine, theirs] = fromMySide(state.choiceLocked, slot);
  const revealed = REVEALED_PHASES.has(phase) && state.revealedChoices ? fromMySide(state.revealedChoices, slot) : null;
  const { result, matchResult } = state;
  return {
    screen: 'arena',
    phase,
    matchId: state.matchId,
    round: state.roundId ?? 0,
    locked: [mine || currentPick(pick, state) !== null, theirs],
    revealed,
    // Place « gagnante » de l'effet, de son côté : celle de la maquette (0 pour les effets symétriques).
    clash: revealed && result ? { kind: result.kind, winner: result.winner === null ? 0 : sideOf(result.winner, slot) } : null,
    celebrate:
      phase === 'ended' && matchResult ? (matchResult.status === 'draw' ? -1 : sideOf(matchResult.winner, slot)) : null,
  };
}
