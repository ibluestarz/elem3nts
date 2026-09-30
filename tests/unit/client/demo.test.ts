import { describe, expect, it } from 'vitest';
import { resolveRound, type PlayerIndex, type RoundKind } from '../../../src/domain/index.ts';
import { DEMO_LABELS, roundBanner } from '../../../src/client/copy.ts';
import { sceneCommands, type SceneCommand, type SceneView } from '../../../src/client/scene/commands.ts';
import {
  DEMO_ARM_MS,
  DEMO_KINDS,
  demoReducer,
  demoSceneView,
  demoScores,
  demoSetup,
  initialDemoState,
  type DemoAction,
  type DemoState,
} from '../../../src/client/state/demo.ts';
import { CYCLE_MS, clashDelays } from '../../../src/client/state/game.ts';

const reduce = (state: DemoState, ...actions: DemoAction[]): DemoState => actions.reduce(demoReducer, state);

/** Avance jusqu'à l'échéance courante, exactement. */
const tick = (state: DemoState): DemoState => {
  if (state.deadline === null) throw new Error('aucune échéance');
  return demoReducer(state, { type: 'tick', now: state.deadline });
};

const onSide = (side: PlayerIndex) => reduce(initialDemoState(), { type: 'side', side });

/** Vainqueur attendu de chaque confrontation (maquette) : le côté choisi, sauf effets symétriques. */
const SYMMETRIC: ReadonlySet<RoundKind> = new Set(['flare', 'siphon', 'balance', 'void']);

describe('PFC-026 — confrontations imposées de la démo', () => {
  it('propose les neuf confrontations, dans l’ordre et avec les libellés de la maquette', () => {
    expect(DEMO_KINDS.map((kind) => DEMO_LABELS[kind])).toEqual([
      'Eau › Feu',
      'Feu › Plante',
      'Plante › Eau',
      'Feu + Feu',
      'Eau + Eau',
      'Plante + Plante · écart',
      'Plante + Plante · égalité',
      'Temps écoulé',
      'Aucun choix',
    ]);
  });

  for (const side of [0, 1] as const) {
    it.each(DEMO_KINDS)(`PFC-026-AC1 — %s, vainqueur ${side === 0 ? 'à gauche' : 'à droite'} : résolution du moteur pur`, (kind) => {
      const state = reduce(onSide(side), { type: 'run', kind, now: 0 });
      const { scores, choices } = demoSetup(kind, side);

      // Explication et deltas : ceux du moteur pur, jamais recalculés (D25).
      expect(state.round).toEqual(resolveRound(scores, choices));
      expect(state.round?.kind).toBe(kind);
      expect(state.round?.winner).toBe(SYMMETRIC.has(kind) ? null : side);
      expect(state.choices).toEqual(choices);
    });
  }

  it('reprend les départs de la maquette : 2/2, écart 1/3 ou 3/1, choix manquants', () => {
    expect(demoSetup('wave', 0)).toEqual({ scores: [2, 2], choices: ['water', 'fire'] });
    expect(demoSetup('wave', 1)).toEqual({ scores: [2, 2], choices: ['fire', 'water'] });
    expect(demoSetup('thrive', 0)).toEqual({ scores: [1, 3], choices: ['plant', 'plant'] });
    expect(demoSetup('thrive', 1)).toEqual({ scores: [3, 1], choices: ['plant', 'plant'] });
    expect(demoSetup('solo', 1)).toEqual({ scores: [2, 2], choices: [null, 'fire'] });
    expect(demoSetup('void', 0)).toEqual({ scores: [2, 2], choices: [null, null] });
  });
});

describe('PFC-026 — déroulé d’une confrontation', () => {
  it('PFC-026-S1 — Eau + Eau : verrous, révélation, effet, −1 pour chacun, puis repos sans manche suivante', () => {
    const armed = reduce(initialDemoState(), { type: 'run', kind: 'siphon', now: 1000 });
    expect(armed).toMatchObject({ phase: 'armed', deadline: 1000 + DEMO_ARM_MS, run: 1 });
    expect(demoScores(armed)).toEqual([2, 2]);

    const reveal = tick(armed);
    expect(reveal).toMatchObject({ phase: 'reveal', deadline: 1000 + DEMO_ARM_MS + CYCLE_MS.reveal });
    const clash = tick(reveal);
    expect(clash).toMatchObject({ phase: 'clash', deadline: (reveal.deadline ?? 0) + clashDelays('siphon').toImpact });
    expect(demoScores(clash)).toEqual([2, 2]);

    const result = tick(clash);
    expect(result.phase).toBe('result');
    expect(result.deadline).toBe((clash.deadline ?? 0) + clashDelays('siphon').afterImpact);
    expect(demoScores(result)).toEqual([1, 1]);
    expect(result.round?.delta).toEqual([-1, -1]);
    expect(result.round && roundBanner(result.round)).toEqual({ title: 'La mer engloutit tout', sub: '−1 pour les 2 joueurs' });

    const rest = tick(result);
    expect(rest).toMatchObject({ phase: 'idle', deadline: null, run: 1 });
    expect(demoScores(rest)).toEqual([1, 1]);
  });

  it('manche vide : révélation courte, comme en partie', () => {
    const armed = reduce(initialDemoState(), { type: 'run', kind: 'void', now: 0 });
    expect(tick(armed).deadline).toBe(DEMO_ARM_MS + CYCLE_MS.revealEmpty);
  });

  it('PFC-026-S2 — une autre confrontation pendant un effet est ignorée, à chaque phase', () => {
    let state = reduce(initialDemoState(), { type: 'run', kind: 'wave', now: 0 });
    while (state.phase !== 'idle') {
      expect(demoReducer(state, { type: 'run', kind: 'flare', now: state.deadline ?? 0 })).toBe(state);
      state = tick(state);
    }
    expect(reduce(state, { type: 'run', kind: 'flare', now: 0 })).toMatchObject({ phase: 'armed', run: 2 });
  });

  it('échéance idempotente : un tick en avance ou répété ne saute aucune phase', () => {
    const armed = reduce(initialDemoState(), { type: 'run', kind: 'burn', now: 0 });
    expect(demoReducer(armed, { type: 'tick', now: DEMO_ARM_MS - 1 })).toBe(armed);
    const reveal = tick(armed);
    expect(demoReducer(reveal, { type: 'tick', now: DEMO_ARM_MS })).toBe(reveal);
    const idle = initialDemoState();
    expect(demoReducer(idle, { type: 'tick', now: 10_000 })).toBe(idle);
  });

  it('le côté vainqueur change à tout moment et ne vaut que pour la confrontation suivante', () => {
    const armed = reduce(initialDemoState(), { type: 'run', kind: 'wave', now: 0 });
    const switched = demoReducer(armed, { type: 'side', side: 1 });
    expect(switched).toMatchObject({ side: 1, phase: 'armed', round: armed.round });
    expect(demoReducer(switched, { type: 'side', side: 1 })).toBe(switched);
  });

  it('0/0 avant toute confrontation', () => {
    expect(demoScores(initialDemoState())).toEqual([0, 0]);
  });
});

describe('PFC-026 — scène de la démo (même pont que la partie)', () => {
  const walk = (kind: RoundKind): SceneView[] => {
    const views = [demoSceneView(initialDemoState())];
    let state = reduce(initialDemoState(), { type: 'run', kind, now: 0 });
    for (;;) {
      views.push(demoSceneView(state));
      if (state.phase === 'idle') return views;
      state = tick(state);
    }
  };

  it('aucun élément transmis avant la révélation : seulement les verrous', () => {
    const [, armed] = walk('siphon');
    expect(armed).toMatchObject({ phase: 'selecting', locked: [true, true], revealed: null, clash: null });
  });

  it('entrée, verrous, révélation, effet puis repos : commandes de la maquette', () => {
    const views = walk('wave');
    const commands: SceneCommand[] = [];
    let previous: SceneView | null = null;
    for (const next of views) {
      commands.push(...sceneCommands(previous, next));
      previous = next;
    }
    expect(commands).toEqual([
      // go('demo') : repos et arène.
      { type: 'reset' },
      { type: 'setScene', scene: 'arena' },
      // runDemo : scène au repos, verrous posés.
      { type: 'reset' },
      { type: 'setScene', scene: 'arena' },
      { type: 'setLock', player: 0, locked: false },
      { type: 'setLock', player: 1, locked: false },
      { type: 'setLock', player: 0, locked: true },
      { type: 'setLock', player: 1, locked: true },
      { type: 'reveal', p1: 'water', p2: 'fire' },
      { type: 'clash', kind: 'wave', winner: 0 },
      // afterRound : repos, sans manche suivante.
      { type: 'reset' },
    ]);
  });

  it('effet symétrique vainqueur à droite : place 0 transmise, comme la maquette', () => {
    let state = reduce(onSide(1), { type: 'run', kind: 'flare', now: 0 });
    while (state.phase !== 'clash') state = tick(state);
    expect(demoSceneView(state).clash).toEqual({ kind: 'flare', winner: 0 });
  });
});
