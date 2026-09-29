import { describe, expect, it } from 'vitest';
import {
  fromMySide,
  onlineArenaModel,
  onlineSceneView,
  phaseAt,
  scoresBefore,
  suddenMarkOf,
  timelineOf,
  trophiesWonOf,
  verdictOf,
  type OwnPick,
} from '../../../src/client/online/game.ts';
import { ServerClock, toLocalTime } from '../../../src/client/online/serverClock.ts';
import { sceneCommands, type SceneView } from '../../../src/client/scene/commands.ts';
import { CYCLE_MS, clashDelays, roundResultMs } from '../../../src/shared/cycle.ts';
import { playRound, startMatch, type Choices, type MatchSettings, type PlayerIndex } from '../../../src/domain/index.ts';
import { projectState, type PublicState, type RoomView } from '../../../src/shared/protocol/index.ts';
import { roomView } from './onlineFakes.ts';

/**
 * PFC-016 — partie en ligne vue par un client : horloge, chronologie calée sur les échéances du
 * serveur, point de vue (« Vous » à gauche) et projection pour la scène. Aucune résolution locale.
 */

const SERVER_NOW = 50_000;
const state = (slot: PlayerIndex, overrides: Partial<RoomView>): PublicState => projectState(roomView(overrides), slot, SERVER_NOW);

const X3: MatchSettings = { target: 3, drawEnabled: true };

/** Manche résolue par le vrai moteur, publiée en `round-result` avec l'échéance que le serveur calculerait. */
function roundResult(slot: PlayerIndex, choices: Choices, settings: MatchSettings = X3, revision = 10): PublicState {
  const play = playRound(startMatch('m-1', settings), choices);
  const end = play.match.result.status !== 'playing';
  const sudden = !end && play.match.scores[0] === play.match.scores[1] && play.match.scores[0] >= settings.target;
  const deadline = SERVER_NOW + roundResultMs(play.round.kind, end ? 'end' : sudden ? 'sudden' : 'next');
  return state(slot, {
    revision,
    phase: 'round-result',
    settings,
    match: play.match,
    roundId: 1,
    selection: choices,
    lastRound: { roundId: 1, choices, resolution: play.round },
    deadline,
  });
}

describe('PFC-016 — horloge du serveur', () => {
  it('garde le plus grand minorant : le décalage ne recule jamais (aucune régression du décompte)', () => {
    const clock = new ServerClock();
    expect(clock.offset).toBeNull();
    clock.sample(10_000, 1_000);
    expect(clock.offset).toBe(9_000);
    // Trame plus lente : minorant plus faible, ignoré.
    clock.sample(10_100, 1_300);
    expect(clock.offset).toBe(9_000);
    // Trajet plus court : estimation affinée, toujours vers l'avant.
    clock.sample(10_200, 1_150);
    expect(clock.offset).toBe(9_050);
    expect(toLocalTime(15_050, 9_050)).toBe(6_000);
  });
});

describe('PFC-016 — chronologie calée sur les échéances du serveur', () => {
  it('ouverture : bannière puis attente de 0,4 s avant l’échéance de `starting`', () => {
    const starting = state(0, { phase: 'starting', match: startMatch('m-1', X3), roundId: 1, deadline: SERVER_NOW + 2_200 });
    const timeline = timelineOf(starting, 45_000);
    expect(timeline.map(({ phase }) => phase)).toEqual(['intro', 'ready']);
    expect(timeline[1]?.start).toBe(5_000 + 2_200 - CYCLE_MS.ready);
    expect(phaseAt(timeline, 6_799)).toBe('intro');
    expect(phaseAt(timeline, 6_800)).toBe('ready');
  });

  it('PFC-016-AC2 — l’horloge locale n’invente aucun résultat : la sélection dure jusqu’au prochain `state`', () => {
    const selecting = state(0, { phase: 'selecting', match: startMatch('m-1', X3), roundId: 1, deadline: SERVER_NOW + 5_000 });
    const timeline = timelineOf(selecting, 45_000);
    expect(phaseAt(timeline, 5_000 + 5_000)).toBe('selecting');
    expect(phaseAt(timeline, 5_000 + 60_000)).toBe('selecting');
    expect(onlineArenaModel({ state: selecting, phase: 'selecting', offset: 45_000, pick: null, sudden: null }).deadline).toBe(10_000);
  });

  it.each([
    ['manche suivante', ['fire', 'plant'] as Choices, X3, ['pause']],
    ['fin de partie', ['fire', 'plant'] as Choices, { target: 1, drawEnabled: true }, ['closing']],
    ['mort subite', ['fire', 'fire'] as Choices, { target: 1, drawEnabled: false }, ['sudden', 'pause']],
  ])('résultat (%s) : révélation, effet, impact et suite de la chronologie locale D09', (_, choices, settings, tail) => {
    const result = roundResult(0, choices, settings);
    const kind = result.result?.kind ?? 'void';
    const timeline = timelineOf(result, SERVER_NOW);
    expect(timeline.map(({ phase }) => phase)).toEqual(['reveal', 'clash', 'result', ...tail]);
    // La révélation a eu lieu à l'échéance de sélection traitée par le serveur (`deadline − roundResultMs`).
    const reveal = 0;
    const { toImpact, afterImpact } = clashDelays(kind);
    expect(timeline[1]?.start).toBe(reveal + CYCLE_MS.reveal);
    expect(timeline[2]?.start).toBe(reveal + CYCLE_MS.reveal + toImpact);
    expect(timeline[3]?.start).toBe(reveal + CYCLE_MS.reveal + toImpact + afterImpact);
    if (tail[0] === 'sudden') expect(timeline[4]?.start).toBe(reveal + CYCLE_MS.reveal + toImpact + afterImpact + CYCLE_MS.sudden);
  });

  it('un état reçu en retard reprend la chronologie au bon moment, sans la rejouer depuis le début', () => {
    const result = roundResult(0, ['water', 'fire']);
    const timeline = timelineOf(result, SERVER_NOW);
    expect(phaseAt(timeline, CYCLE_MS.reveal + 10)).toBe('clash');
  });
});

describe('PFC-016 — point de vue du joueur', () => {
  it('J2 se voit à gauche : noms, scores et choix révélés inversés, gagnant nommé « Vous »', () => {
    const result = roundResult(1, ['fire', 'water']);
    const model = onlineArenaModel({ state: result, phase: 'result', offset: SERVER_NOW, pick: null, sudden: null });
    expect(model.names).toEqual(['Vous', 'Joueur 1']);
    expect(model.scores).toEqual([1, 0]);
    expect(model.deltas).toEqual([1, 0]);
    expect(model.statuses.map(({ text }) => text)).toEqual(['Eau', 'Feu']);
    expect(model.banner).toEqual({ title: 'L’Eau éteint le Feu', sub: '+1 pour Vous' });
  });

  it('pendant la révélation et l’effet, les scores d’avant la manche restent affichés', () => {
    const result = roundResult(0, ['water', 'fire']);
    for (const phase of ['reveal', 'clash'] as const) {
      expect(onlineArenaModel({ state: result, phase, offset: SERVER_NOW, pick: null, sudden: null }).scores).toEqual([0, 0]);
    }
  });

  it('PFC-016-AC1 — sélection : son propre choix affiché, celui de l’adversaire jamais (verrou seul)', () => {
    const selecting = state(1, {
      phase: 'selecting',
      match: startMatch('m-1', X3),
      roundId: 1,
      selection: ['plant', 'fire'],
      deadline: SERVER_NOW + 5_000,
    });
    const pick: OwnPick = { matchId: 'm-1', roundId: 1, element: 'fire' };
    const model = onlineArenaModel({ state: selecting, phase: 'selecting', offset: SERVER_NOW, pick, sudden: null });
    expect(model.statuses).toEqual([
      { text: 'Choix verrouillé · Feu', tone: 'locked' },
      { text: 'Choix verrouillé', tone: 'locked' },
    ]);
    expect(JSON.stringify(model)).not.toMatch(/Plante|plant/);
    expect(JSON.stringify(selecting)).not.toMatch(/plant|fire/);
    // Un choix d'une autre manche n'est jamais montré.
    const stale = onlineArenaModel({ state: selecting, phase: 'selecting', offset: SERVER_NOW, pick: { ...pick, roundId: 0 }, sudden: null });
    expect(stale.statuses[0]).toEqual({ text: 'Choix verrouillé', tone: 'locked' });
    expect(onlineArenaModel({ state: state(0, { phase: 'selecting', match: startMatch('m-1', X3), roundId: 1 }), phase: 'selecting', offset: 0, pick: null, sudden: null }).statuses).toEqual([
      { text: 'Choix en cours…', tone: null },
      { text: 'Réfléchit…', tone: null },
    ]);
  });

  it('scores d’avant : déduits des deltas effectifs, plancher zéro compris', () => {
    expect(scoresBefore([0, 0], { kind: 'siphon', winner: null, delta: [0, -1] })).toEqual([0, 1]);
    expect(fromMySide([3, 5], 1)).toEqual([5, 3]);
  });

  it('mort subite : mention affichée à partir de sa bannière, puis jusqu’à la fin de la partie', () => {
    const result = roundResult(0, ['fire', 'fire'], { target: 1, drawEnabled: false });
    const mark = suddenMarkOf(result);
    expect(mark).toEqual({ matchId: 'm-1', roundId: 1 });
    const at = (phase: 'result' | 'sudden') => onlineArenaModel({ state: result, phase, offset: SERVER_NOW, pick: null, sudden: mark }).sudden;
    expect(at('result')).toBe(false);
    expect(at('sudden')).toBe(true);
    const next = state(0, { phase: 'selecting', match: startMatch('m-1', { target: 1, drawEnabled: false }), roundId: 2 });
    expect(onlineArenaModel({ state: next, phase: 'selecting', offset: 0, pick: null, sudden: mark }).sudden).toBe(true);
  });

  it('fin de partie : Victoire, Défaite ou Match nul, et trophée de chacun de son côté', () => {
    expect(verdictOf({ status: 'won', winner: 1 }, 1)).toEqual({ title: 'Victoire', sub: 'Vous remportez la partie' });
    expect(verdictOf({ status: 'won', winner: 1 }, 0)).toEqual({ title: 'Défaite', sub: 'Joueur 2 remporte la partie' });
    expect(verdictOf({ status: 'draw' }, 0).title).toBe('Match nul');
    expect(trophiesWonOf({ status: 'won', winner: 1 }, 1)).toEqual([true, false]);
    expect(trophiesWonOf({ status: 'draw' }, 0)).toEqual([true, true]);
  });
});

describe('PFC-016 — scène 3D en ligne', () => {
  it('verrous seuls en sélection, éléments et gagnant de son côté après révélation', () => {
    const selecting = state(1, { phase: 'selecting', match: startMatch('m-1', X3), roundId: 1, selection: ['plant', null] });
    const view = onlineSceneView(selecting, 'selecting', null);
    expect(view).toMatchObject({ screen: 'arena', locked: [false, true], revealed: null, clash: null });

    const result = roundResult(1, ['fire', 'water']);
    expect(onlineSceneView(result, 'clash', null)).toMatchObject({
      revealed: ['water', 'fire'],
      clash: { kind: 'wave', winner: 0 },
    });
  });

  it('un état reçu pendant l’effet révèle d’abord les éléments, puis joue l’effet', () => {
    const selecting: SceneView = onlineSceneView(state(0, { phase: 'selecting', match: startMatch('m-1', X3), roundId: 1 }), 'selecting', null);
    const late = onlineSceneView(roundResult(0, ['water', 'fire']), 'clash', null);
    expect(sceneCommands(selecting, late).map(({ type }) => type)).toEqual(['reveal', 'clash']);
  });

  it('hors partie : scène de l’accueil', () => {
    expect(onlineSceneView(null, 'intro', null).screen).toBe('home');
    expect(onlineSceneView(state(0, {}), 'pause', null).screen).toBe('home');
  });
});
