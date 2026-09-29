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
const tick = (now: number, canSelect = true): GameAction => ({ type: 'tick', now, canSelect });
const choose = (player: 0 | 1, element: 'fire' | 'water' | 'plant'): GameAction => ({ type: 'choose', player, element });

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

  it('sur téléphone (sans saisie), la partie attend avant la sélection puis reprend au bureau', () => {
    const ready = run({ type: 'start', drawEnabled: true, now: 0 }, tick(CYCLE_MS.banner));
    const waiting = gameReducer(ready, tick(SELECT_AT + 10_000, false));
    expect(waiting).toBe(ready);
    expect(gameReducer(waiting, tick(SELECT_AT + 10_000, true))).toMatchObject({
      phase: 'selecting',
      deadline: SELECT_AT + 10_000 + CYCLE_MS.selection,
    });
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
