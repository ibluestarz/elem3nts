import { describe, expect, it } from 'vitest';
import {
  CYCLE_MS,
  displayedScores,
  trophiesWon,
  gameReducer,
  initialGameState,
  isMatchInProgress,
  type GameAction,
  type GameState,
} from '../../../src/client/state/game.ts';

const run = (...actions: GameAction[]): GameState => actions.reduce(gameReducer, initialGameState());

describe('PFC-004 — état de préparation', () => {
  it('démarre à X = 3 (D07) sans partie', () => {
    expect(initialGameState()).toMatchObject({ target: 3, draft: '3', match: null, started: 0 });
  });

  it('PFC-004-S1 — X = 10 et nul OFF donnent une partie à ces réglages', () => {
    const state = run({ type: 'draft', text: '10' }, { type: 'start', drawEnabled: false, now: 0 });

    expect(state.match?.settings).toEqual({ target: 10, drawEnabled: false });
    expect(isMatchInProgress(state)).toBe(true);
  });

  it('PFC-004-S2 — X = 11 garde la saisie, conserve la dernière valeur valide et bloque le lancement', () => {
    const state = run({ type: 'draft', text: '11' });

    expect(state).toMatchObject({ draft: '11', target: 3 });
    expect(gameReducer(state, { type: 'start', drawEnabled: true, now: 0 })).toBe(state);
  });

  it.each(['0', '', '2.5', 'abc'])('refuse de lancer avec la saisie %j', (text) => {
    const state = run({ type: 'draft', text });
    expect(gameReducer(state, { type: 'start', drawEnabled: true, now: 0 }).match).toBeNull();
  });

  it('borne −, + et les pastilles sans jamais sortir de 1–10', () => {
    expect(run({ type: 'target', value: 1 }, { type: 'step', delta: -1 }).target).toBe(1);
    expect(run({ type: 'target', value: 10 }, { type: 'step', delta: 1 }).target).toBe(10);
    expect(run({ type: 'draft', text: '11' }, { type: 'step', delta: -1 })).toMatchObject({ target: 2, draft: '2' });
  });
});

describe('PFC-004-AC3 — réglages figés pendant la partie', () => {
  it('ignore toute modification de X tant que la partie est en cours', () => {
    const playing = run({ type: 'draft', text: '5' }, { type: 'start', drawEnabled: true, now: 0 });

    for (const action of [
      { type: 'draft', text: '9' },
      { type: 'target', value: 1 },
      { type: 'step', delta: 1 },
      { type: 'start', drawEnabled: false, now: 0 },
    ] as const) {
      expect(gameReducer(playing, action)).toBe(playing);
    }
    expect(playing.match?.settings).toEqual({ target: 5, drawEnabled: true });
  });

  it('quitter annule la partie sans trophée et libère les réglages', () => {
    const quit = run({ type: 'start', drawEnabled: true, now: 0 }, { type: 'quit' });

    expect(quit.match).toBeNull();
    expect(quit.session).toMatchObject({ trophies: [0, 0], settledMatchIds: ['local-1'] });
    expect(gameReducer(quit, { type: 'target', value: 7 }).target).toBe(7);
  });

  it('attribue un nouveau matchId à chaque partie lancée', () => {
    const second = run({ type: 'start', drawEnabled: true, now: 0 }, { type: 'quit' }, { type: 'start', drawEnabled: true, now: 0 });
    expect(second.match?.id).toBe('local-2');
  });
});

/** Début de la sélection : ouverture 1,8 s puis 0,4 s (maquette). */
const SELECT_AT = CYCLE_MS.banner + CYCLE_MS.ready;
const tick = (now: number, hotseat = false): GameAction => ({ type: 'tick', now, hotseat });
const choose = (player: 0 | 1, element: 'fire' | 'water' | 'plant', now = 0): GameAction => ({ type: 'choose', player, element, now });

function selectingState(options: { target?: number; drawEnabled?: boolean } = {}): GameState {
  return run(
    { type: 'target', value: options.target ?? 3 },
    { type: 'start', drawEnabled: options.drawEnabled ?? true, now: 0 },
    tick(CYCLE_MS.banner),
    tick(SELECT_AT),
  );
}

/** Enchaîne les échéances de la manche en cours jusqu'à la phase voulue. */
function advanceTo(state: GameState, phase: GameState['phase']): GameState {
  let current = state;
  for (let guard = 0; current.phase !== phase; guard++) {
    if (current.deadline === null || guard > 20) throw new Error(`Phase ${phase} inaccessible depuis ${current.phase}`);
    current = gameReducer(current, tick(current.deadline));
  }
  return current;
}

describe('PFC-005 — phase de sélection', () => {
  it('une partie commence en ouverture, puis passe en sélection après 1,8 s + 0,4 s', () => {
    const intro = run({ type: 'start', drawEnabled: true, now: 0 });
    expect(intro).toMatchObject({ phase: 'intro', selection: [null, null], deadline: CYCLE_MS.banner });
    const ready = gameReducer(intro, tick(CYCLE_MS.banner));
    expect(ready).toMatchObject({ phase: 'ready', deadline: SELECT_AT });
    expect(gameReducer(ready, tick(SELECT_AT))).toMatchObject({ phase: 'selecting', round: 1 });
  });

  it('ignore tout choix hors sélection (accueil, ouverture)', () => {
    const idle = initialGameState();
    expect(gameReducer(idle, choose(0, 'fire'))).toBe(idle);
    expect(gameReducer(idle, tick(99999))).toBe(idle);
    const intro = run({ type: 'start', drawEnabled: true, now: 0 });
    expect(gameReducer(intro, choose(0, 'fire'))).toBe(intro);
  });

  it('PFC-005-S1 — J1 feu puis J2 plante sont verrouillés', () => {
    const state = [choose(0, 'fire'), choose(1, 'plant')].reduce(gameReducer, selectingState());
    expect(state.selection).toEqual(['fire', 'plant']);
  });

  it('PFC-005-S2 — un second choix de J1 laisse l’état inchangé', () => {
    const fire = gameReducer(selectingState(), choose(0, 'fire'));
    expect(gameReducer(fire, choose(0, 'water'))).toBe(fire);
  });

  it('quitter efface la sélection et revient à l’ouverture', () => {
    const fire = gameReducer(selectingState(), choose(0, 'fire'));
    expect(gameReducer(fire, { type: 'quit' })).toMatchObject({
      match: null,
      phase: 'intro',
      deadline: null,
      selection: [null, null],
    });
  });
});

describe('PFC-006-AC1 — fenêtre de 5 s et résolution unique', () => {
  it('PFC-006-S1 — deux choix à t=1000 : rien à 4999, révélation et une seule résolution à 5000', () => {
    const t0 = SELECT_AT;
    const locked = [choose(0, 'fire'), choose(1, 'plant')].reduce(gameReducer, selectingState());
    expect(locked.deadline).toBe(t0 + 5000);

    const early = gameReducer(locked, tick(t0 + 4999));
    expect(early).toBe(locked);

    const revealed = gameReducer(locked, tick(t0 + 5000));
    expect(revealed).toMatchObject({ phase: 'reveal', revealed: ['fire', 'plant'], deadline: t0 + 5000 + CYCLE_MS.reveal });
    expect(revealed.match?.scores).toEqual([1, 0]);
    expect(revealed.play?.round).toMatchObject({ kind: 'burn', before: [0, 0], after: [1, 0] });
    // Pendant la révélation, le HUD garde les scores d'avant (maquette).
    expect(displayedScores(revealed)).toEqual([0, 0]);

    // Échéance rejouée (minuterie ou StrictMode) : aucun effet.
    expect(gameReducer(revealed, tick(t0 + 5000))).toBe(revealed);
    const result = advanceTo(revealed, 'result');
    expect(displayedScores(result)).toEqual([1, 0]);
    const resultDeadline = result.deadline ?? Number.NaN;
    expect(gameReducer(result, tick(resultDeadline - 1))).toBe(result);
    expect(gameReducer(result, tick(resultDeadline)).phase).toBe('pause');
  });

  it('PFC-006-S2 — seul J1 choisit feu : +1 (R11), puis une nouvelle manche vide commence', () => {
    const fireOnly = gameReducer(selectingState(), choose(0, 'fire'));
    const result = advanceTo(fireOnly, 'result');
    expect(result.play?.round).toMatchObject({ kind: 'solo', winner: 0 });
    expect(result.match?.scores).toEqual([1, 0]);

    const pause = advanceTo(result, 'pause');
    expect(pause.deadline).toBe((result.deadline ?? 0) + CYCLE_MS.pause);
    const next = advanceTo(pause, 'selecting');
    expect(next).toMatchObject({ round: 2, selection: [null, null], revealed: null, play: null });
  });

  it('manche vide (R12) : aucun point, révélation raccourcie à 0,5 s', () => {
    const reveal = advanceTo(selectingState(), 'reveal');
    expect(reveal.play?.round.kind).toBe('void');
    expect(reveal.deadline).toBe(SELECT_AT + 5000 + CYCLE_MS.revealEmpty);
    expect(advanceTo(reveal, 'pause').match?.scores).toEqual([0, 0]);
  });

  it('une échéance traitée en retard fixe la suivante à partir du retard, sans rattrapage', () => {
    const late = gameReducer(selectingState(), tick(SELECT_AT + 60_000));
    expect(late).toMatchObject({ phase: 'reveal', deadline: SELECT_AT + 60_000 + CYCLE_MS.revealEmpty });
  });
});

describe('PFC-006-AC2 — saisie et enchaînement', () => {
  it('ignore toute saisie pendant révélation, résultat et pause', () => {
    const reveal = advanceTo(gameReducer(selectingState(), choose(0, 'fire')), 'reveal');
    for (const state of [reveal, advanceTo(reveal, 'result'), advanceTo(reveal, 'pause')]) {
      expect(gameReducer(state, choose(1, 'water'))).toBe(state);
    }
  });

  it('mort subite : égalité au-delà de X avec nul OFF, bannière puis manche suivante', () => {
    const fireFire = [choose(0, 'fire'), choose(1, 'fire')].reduce(gameReducer, selectingState({ target: 1, drawEnabled: false }));
    const sudden = advanceTo(fireFire, 'sudden');
    expect(sudden).toMatchObject({ sudden: true, deadline: (advanceTo(fireFire, 'result').deadline ?? 0) + CYCLE_MS.sudden });
    expect(sudden.match?.result.status).toBe('playing');
    const pause = advanceTo(sudden, 'pause');
    expect(pause.deadline).toBe((sudden.deadline ?? 0) + CYCLE_MS.suddenPause);
    expect(advanceTo(pause, 'selecting')).toMatchObject({ round: 2, sudden: true });
  });
});

describe('PFC-006 — fin de partie et trophées', () => {
  it('victoire : fin 0,7 s après le résultat, trophée réglé une seule fois', () => {
    const won = [choose(0, 'fire'), choose(1, 'plant')].reduce(gameReducer, selectingState({ target: 1 }));
    const closing = advanceTo(won, 'closing');
    expect(closing.session.trophies).toEqual([0, 0]);
    const ended = advanceTo(closing, 'ended');
    expect(ended).toMatchObject({ deadline: null });
    expect(ended.session).toMatchObject({ trophies: [1, 0], settledMatchIds: ['local-1'] });
    expect(gameReducer(ended, tick(Number.MAX_SAFE_INTEGER))).toBe(ended);
    expect(gameReducer(ended, choose(0, 'fire'))).toBe(ended);
  });

  it('nul ON à X : un trophée chacun ; quitter après la fin ne change pas la session', () => {
    const draw = [choose(0, 'fire'), choose(1, 'fire')].reduce(gameReducer, selectingState({ target: 1, drawEnabled: true }));
    const ended = advanceTo(draw, 'ended');
    expect(ended.session.trophies).toEqual([1, 1]);
    expect(gameReducer(ended, { type: 'quit' }).session).toBe(ended.session);
  });
});

describe('PFC-007 — revanche et session', () => {
  const endedWin = () => advanceTo([choose(0, 'fire'), choose(1, 'plant')].reduce(gameReducer, selectingState({ target: 1 })), 'ended');

  it('revanche : mêmes réglages, nouveau matchId, scores à zéro, trophées conservés', () => {
    const ended = endedWin();
    const rematch = gameReducer(ended, { type: 'rematch', now: 50_000 });

    expect(rematch.match).toMatchObject({ id: 'local-2', scores: [0, 0], settings: ended.match?.settings });
    expect(rematch).toMatchObject({ phase: 'intro', deadline: 50_000 + CYCLE_MS.banner, round: 0, sudden: false });
    expect(rematch.session).toBe(ended.session);
  });

  it('PFC-007-AC2 — une seconde revanche (Espace maintenu) est sans effet : matchId change une seule fois', () => {
    const rematch = gameReducer(endedWin(), { type: 'rematch', now: 50_000 });
    expect(gameReducer(rematch, { type: 'rematch', now: 50_010 })).toBe(rematch);
    const idle = initialGameState();
    expect(gameReducer(idle, { type: 'rematch', now: 0 })).toBe(idle);
  });

  it('la revanche ignore une saisie de X faite sur l’écran de fin', () => {
    const edited = gameReducer(endedWin(), { type: 'draft', text: '7' });
    expect(gameReducer(edited, { type: 'rematch', now: 0 }).match?.settings.target).toBe(1);
  });

  it('PFC-007-S2 — nouvelle session : trophées à 0/0 ; refusée pendant une partie', () => {
    const fresh = gameReducer(endedWin(), { type: 'new-session' });
    expect(fresh).toMatchObject({ match: null, phase: 'intro', session: { trophies: [0, 0], settledMatchIds: [] } });
    const playing = selectingState();
    expect(gameReducer(playing, { type: 'new-session' })).toBe(playing);
  });

  it('trophées gagnés : vainqueur seul, les deux sur un nul, personne sur une annulation', () => {
    const won = endedWin().match;
    const drawn = advanceTo([choose(0, 'fire'), choose(1, 'fire')].reduce(gameReducer, selectingState({ target: 1 })), 'ended').match;
    if (!won || !drawn) throw new Error('parties manquantes');
    expect(trophiesWon(won)).toEqual([true, false]);
    expect(trophiesWon(drawn)).toEqual([true, true]);
    expect(trophiesWon({ ...won, result: { status: 'cancelled' } })).toEqual([false, false]);
  });
});

describe('PFC-025 — tour par tour sur un seul téléphone', () => {
  /** Voile de Joueur 1 de la première manche, ouverte en tour par tour. */
  const gateState = (target = 3): GameState =>
    run({ type: 'target', value: target }, { type: 'start', drawEnabled: true, now: 0 }, tick(CYCLE_MS.banner, true), tick(SELECT_AT, true));
  const ready = (now: number): GameAction => ({ type: 'turn-ready', now });

  it('la manche s’ouvre sur le voile de Joueur 1, sans échéance : rien ne presse le passage de l’appareil', () => {
    const gate = gateState();
    expect(gate).toMatchObject({ phase: 'gate', turn: 0, round: 1, deadline: null, selection: [null, null] });
    expect(gameReducer(gate, tick(SELECT_AT + 60_000, true))).toBe(gate);
    expect(gameReducer(gate, choose(0, 'fire'))).toBe(gate);
  });

  it('PFC-025-S1 — J1 prêt puis Feu : voile de Joueur 2, choix gardé mais jamais révélé', () => {
    const selecting = gameReducer(gateState(), ready(3000));
    expect(selecting).toMatchObject({ phase: 'selecting', turn: 0, deadline: 3000 + CYCLE_MS.selection });
    // Seul le joueur dont c'est le tour choisit.
    expect(gameReducer(selecting, choose(1, 'water', 3100))).toBe(selecting);

    const handedOver = gameReducer(selecting, choose(0, 'fire', 3500));
    expect(handedOver).toMatchObject({ phase: 'gate', turn: 1, deadline: null, selection: ['fire', null], revealed: null, play: null });
    expect(handedOver.match?.scores).toEqual([0, 0]);
  });

  it('AC1 — J2 a 5 s après son « prêt » ; son choix déclenche une seule révélation, aussitôt', () => {
    const gate2 = [ready(3000), choose(0, 'fire', 3500)].reduce(gameReducer, gateState());
    const turn2 = gameReducer(gate2, ready(9000));
    expect(turn2).toMatchObject({ phase: 'selecting', turn: 1, deadline: 9000 + CYCLE_MS.selection });
    expect(gameReducer(turn2, choose(0, 'plant', 9100))).toBe(turn2);

    const reveal = gameReducer(turn2, choose(1, 'water', 9400));
    expect(reveal).toMatchObject({ phase: 'reveal', revealed: ['fire', 'water'], deadline: 9400 + CYCLE_MS.reveal });
    expect(reveal.match?.scores).toEqual([0, 1]);
    // Plus aucune saisie ni seconde résolution : l'échéance de sélection dépassée ne rejoue rien.
    expect(gameReducer(reveal, choose(1, 'fire', 9500))).toBe(reveal);
    expect(advanceTo(reveal, 'result').match?.scores).toEqual([0, 1]);
  });

  it('PFC-025-S2 — J1 hors délai, J2 choisit Eau : R11, +1 pour Joueur 2', () => {
    const turn1 = gameReducer(gateState(), ready(3000));
    const late = gameReducer(turn1, tick(3000 + CYCLE_MS.selection, true));
    expect(late).toMatchObject({ phase: 'gate', turn: 1, selection: [null, null] });

    const reveal = [ready(12_000), choose(1, 'water', 12_300)].reduce(gameReducer, late);
    expect(reveal).toMatchObject({ phase: 'reveal', revealed: [null, 'water'] });
    expect(reveal.play?.round).toMatchObject({ kind: 'solo', winner: 1 });
    expect(reveal.match?.scores).toEqual([0, 1]);
  });

  it('J2 hors délai : la révélation part de son échéance (R11 pour Joueur 1, ou manche vide R12)', () => {
    const turn2 = [ready(3000), choose(0, 'plant', 3200), ready(4000)].reduce(gameReducer, gateState());
    const reveal = gameReducer(turn2, tick(4000 + CYCLE_MS.selection, true));
    expect(reveal).toMatchObject({ phase: 'reveal', revealed: ['plant', null] });
    expect(reveal.match?.scores).toEqual([1, 0]);

    const empty = [ready(3000), tick(3000 + CYCLE_MS.selection, true), ready(9000), tick(9000 + CYCLE_MS.selection, true)].reduce(
      gameReducer,
      gateState(),
    );
    expect(empty.play?.round.kind).toBe('void');
    expect(empty.match?.scores).toEqual([0, 0]);
  });

  it('« prêt » hors voile ou répété : sans effet', () => {
    const turn1 = gameReducer(gateState(), ready(3000));
    expect(gameReducer(turn1, ready(3100))).toBe(turn1);
    const idle = initialGameState();
    expect(gameReducer(idle, ready(0))).toBe(idle);
  });

  it('la manche suivante rouvre le voile de Joueur 1', () => {
    const reveal = [ready(3000), choose(0, 'fire', 3100), ready(4000), choose(1, 'plant', 4100)].reduce(gameReducer, gateState());
    let state = reveal;
    for (let guard = 0; state.phase !== 'gate' && guard < 10; guard++) state = gameReducer(state, tick(state.deadline ?? 0, true));
    expect(state).toMatchObject({ phase: 'gate', turn: 0, round: 2, selection: [null, null], revealed: null });
  });

  it('AC3 — le mode est fixé à l’ouverture de la manche : un redimensionnement ne le change qu’à la suivante', () => {
    // Manche simultanée ouverte au bureau, puis passage au téléphone : elle se termine en simultané.
    const simultaneous = [choose(0, 'fire'), choose(1, 'plant')].reduce(gameReducer, selectingState());
    expect(simultaneous.turn).toBeNull();
    const resolved = gameReducer(simultaneous, tick(SELECT_AT + CYCLE_MS.selection, true));
    expect(resolved).toMatchObject({ phase: 'reveal', revealed: ['fire', 'plant'] });
    let next = resolved;
    for (let guard = 0; next.phase !== 'gate' && guard < 10; guard++) next = gameReducer(next, tick(next.deadline ?? 0, true));
    expect(next).toMatchObject({ phase: 'gate', turn: 0, round: 2 });

    // Manche en tour par tour, puis passage au bureau : le tour de Joueur 1 mène toujours au voile de Joueur 2.
    const turn1 = gameReducer(gateState(), ready(3000));
    expect(gameReducer(turn1, tick(3000 + CYCLE_MS.selection, false))).toMatchObject({ phase: 'gate', turn: 1 });
  });
});
