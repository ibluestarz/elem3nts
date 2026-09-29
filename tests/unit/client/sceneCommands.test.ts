import { describe, expect, it } from 'vitest';
import { sceneCommands, type SceneView } from '../../../src/client/scene/commands.ts';
import { sceneViewOf } from '../../../src/client/scene/useSceneBridge.ts';
import {
  clashDelays,
  gameReducer,
  initialGameState,
  type GameAction,
  type GameState,
} from '../../../src/client/state/game.ts';

const base: SceneView = {
  screen: 'arena',
  phase: 'selecting',
  matchId: 'local-1',
  round: 1,
  locked: [false, false],
  revealed: null,
  clash: null,
  celebrate: null,
};
const view = (patch: Partial<SceneView>): SceneView => ({ ...base, ...patch });

describe('PFC-008 — la scène ne reçoit que des événements décidés (sceneCommands)', () => {
  it('écrans : préparation et arène sur la scène d’arène, remise au repos sauf pour les réglages', () => {
    const home = view({ screen: 'home', matchId: null, phase: 'intro' });
    expect(sceneCommands(null, home)).toEqual([{ type: 'reset' }, { type: 'setScene', scene: 'home' }]);
    expect(sceneCommands(home, { ...home, screen: 'setup' })).toEqual([
      { type: 'reset' },
      { type: 'setScene', scene: 'arena' },
    ]);
    expect(sceneCommands(home, { ...home, screen: 'settings' })).toEqual([{ type: 'setScene', scene: 'home' }]);
  });

  it('nouvelle partie puis sélection : repos, arène, verrous effacés', () => {
    const setup = view({ screen: 'setup', matchId: null, phase: 'intro', round: 0 });
    const intro = view({ phase: 'intro', round: 0 });
    expect(sceneCommands(setup, intro)).toEqual([
      { type: 'setScene', scene: 'arena' },
      { type: 'reset' },
      { type: 'setScene', scene: 'arena' },
    ]);
    expect(sceneCommands(intro, base)).toEqual([
      { type: 'setLock', player: 0, locked: false },
      { type: 'setLock', player: 1, locked: false },
    ]);
  });

  it('un verrou n’est transmis qu’une fois, sans l’élément', () => {
    const locked = view({ locked: [true, false] });
    expect(sceneCommands(base, locked)).toEqual([{ type: 'setLock', player: 0, locked: true }]);
    expect(sceneCommands(locked, locked)).toEqual([]);
  });

  it('révélation, chorégraphie, repos puis célébration, dans l’ordre de la maquette', () => {
    const reveal = view({ phase: 'reveal', locked: [true, true], revealed: ['fire', 'plant'], clash: { kind: 'burn', winner: 0 } });
    expect(sceneCommands(base, reveal)).toEqual([{ type: 'reveal', p1: 'fire', p2: 'plant' }]);
    const clash = { ...reveal, phase: 'clash' as const };
    expect(sceneCommands(reveal, clash)).toEqual([{ type: 'clash', kind: 'burn', winner: 0 }]);
    const result = { ...clash, phase: 'result' as const };
    expect(sceneCommands(clash, result)).toEqual([]);
    const closing = { ...result, phase: 'closing' as const };
    expect(sceneCommands(result, closing)).toEqual([{ type: 'reset' }]);
    const ended = { ...closing, phase: 'ended' as const, celebrate: -1 as const };
    expect(sceneCommands(closing, ended)).toEqual([
      { type: 'setScene', scene: 'arena' },
      { type: 'celebrate', winner: -1 },
    ]);
  });

  it('mort subite puis pause : une seule remise au repos', () => {
    const result = view({ phase: 'result' });
    const sudden = view({ phase: 'sudden' });
    expect(sceneCommands(result, sudden)).toEqual([{ type: 'reset' }]);
    expect(sceneCommands(sudden, view({ phase: 'pause' }))).toEqual([]);
  });
});

describe('PFC-008 — projection du jeu pour la scène (sceneViewOf)', () => {
  const run = (...actions: GameAction[]): GameState => actions.reduce(gameReducer, initialGameState());
  const tick = (now: number): GameAction => ({ type: 'tick', now, hotseat: false });

  it('pendant la sélection, seuls des verrous : aucun élément choisi ne sort du jeu', () => {
    const selecting = run({ type: 'start', drawEnabled: true, now: 0 }, tick(1800), tick(2200), {
      type: 'choose',
      player: 0,
      element: 'fire',
      now: 2300,
    });
    const projected = sceneViewOf('arena', selecting);
    expect(projected).toMatchObject({ phase: 'selecting', locked: [true, false], revealed: null, clash: null });
    expect(JSON.stringify(projected)).not.toMatch(/fire|water|plant/);
  });

  it('après l’échéance : choix révélés et chorégraphie de la résolution', () => {
    const reveal = run(
      { type: 'start', drawEnabled: true, now: 0 },
      tick(1800),
      tick(2200),
      { type: 'choose', player: 0, element: 'water', now: 2300 },
      { type: 'choose', player: 1, element: 'water', now: 2300 },
      tick(7200),
    );
    expect(sceneViewOf('arena', reveal)).toMatchObject({
      phase: 'reveal',
      revealed: ['water', 'water'],
      clash: { kind: 'siphon', winner: 0 },
    });
  });

  it('après la manche (pause) : plus d’éléments ni d’effet projetés, la scène revient au repos', () => {
    const pause = run(
      { type: 'start', drawEnabled: true, now: 0 },
      tick(1800),
      tick(2200),
      { type: 'choose', player: 0, element: 'fire', now: 2300 },
      { type: 'choose', player: 1, element: 'plant', now: 2300 },
      tick(7200),
      tick(8300),
      tick(8300 + clashDelays('burn').toImpact),
      tick(8300 + clashDelays('burn').toImpact + clashDelays('burn').afterImpact),
    );
    expect(pause.phase).toBe('pause');
    expect(sceneViewOf('arena', pause)).toMatchObject({ phase: 'pause', revealed: null, clash: null });
  });
});
