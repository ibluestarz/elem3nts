import type { Choice, RoundKind } from '../../domain/index.ts';
import type { Phase } from '../state/game.ts';
import type { ClashKind, EngineElement, SceneName } from './engine.js';

/** Écrans de l'application vus par la scène ; `demo` rejoue une confrontation hors partie (PFC-026). */
export type SceneScreen = 'home' | 'setup' | 'rules' | 'settings' | 'arena' | 'demo';

/**
 * Projection de l'état du jeu utile à la scène. Les choix n'y figurent qu'une fois révélés :
 * pendant la sélection, seuls les verrous (booléens) sont transmis.
 */
export interface SceneView {
  readonly screen: SceneScreen;
  readonly phase: Phase;
  readonly matchId: string | null;
  readonly round: number;
  readonly locked: readonly [boolean, boolean];
  readonly revealed: readonly [Choice, Choice] | null;
  readonly clash: { readonly kind: RoundKind; readonly winner: 0 | 1 } | null;
  /** Vainqueur de la partie terminée, -1 pour un nul. */
  readonly celebrate: 0 | 1 | -1 | null;
}

export type SceneCommand =
  | { readonly type: 'setScene'; readonly scene: SceneName }
  | { readonly type: 'reset' }
  | { readonly type: 'setLock'; readonly player: 0 | 1; readonly locked: boolean }
  | { readonly type: 'reveal'; readonly p1: EngineElement | null; readonly p2: EngineElement | null }
  | { readonly type: 'clash'; readonly kind: ClashKind; readonly winner: 0 | 1 }
  | { readonly type: 'celebrate'; readonly winner: 0 | 1 | -1 };

/** Scène de fond par écran (maquette `go`) : l'arène dès la préparation. */
const sceneOf = (screen: SceneScreen): SceneName => (screen === 'home' || screen === 'rules' || screen === 'settings' ? 'home' : 'arena');

/** Écrans dont l'entrée remet la scène au repos (maquette `go` : tout sauf les réglages). */
const RESETTING: ReadonlySet<SceneScreen> = new Set(['home', 'setup', 'rules', 'demo']);

/** Écrans où se jouent des manches : partie et démo. */
const PLAYING: ReadonlySet<SceneScreen> = new Set(['arena', 'demo']);

/** Phases d'après-manche : la maquette remet la scène au repos (`afterRound`). */
const AFTER_ROUND: ReadonlySet<Phase> = new Set(['pause', 'sudden', 'closing']);

/** Phases où les éléments de la manche sont révélés. */
const REVEALED: ReadonlySet<Phase> = new Set(['reveal', 'clash', 'result']);

/**
 * Commandes moteur pour passer de `prev` à `next`, dans l'ordre de la maquette. Fonction pure :
 * la scène ne reçoit que des événements déjà décidés par le jeu, jamais un choix caché.
 */
export function sceneCommands(prev: SceneView | null, next: SceneView): readonly SceneCommand[] {
  const commands: SceneCommand[] = [];
  const entered = (phase: Phase) => next.phase === phase && prev?.phase !== phase;

  if (prev?.screen !== next.screen) {
    if (RESETTING.has(next.screen)) commands.push({ type: 'reset' });
    commands.push({ type: 'setScene', scene: sceneOf(next.screen) });
  }
  if (!PLAYING.has(next.screen) || next.matchId === null) return commands;

  // Nouvelle partie (début ou revanche) : scène d'arène au repos (maquette `startMatch`).
  if (prev?.matchId !== next.matchId) commands.push({ type: 'reset' }, { type: 'setScene', scene: 'arena' });
  const sameRound = prev?.matchId === next.matchId && prev.round === next.round;
  if (next.phase === 'selecting' && !(sameRound && prev.phase === 'selecting')) {
    commands.push({ type: 'setLock', player: 0, locked: false }, { type: 'setLock', player: 1, locked: false });
  }
  if (next.phase === 'selecting') {
    for (const player of [0, 1] as const) {
      const was = sameRound && prev.phase === 'selecting' ? prev.locked[player] : false;
      if (next.locked[player] && !was) commands.push({ type: 'setLock', player, locked: true });
    }
  }
  // Révélation à l'entrée dans la manche révélée, même si un état reçu en retard (en ligne) arrive
  // directement pendant l'effet : la scène montre toujours les éléments avant la chorégraphie.
  const wasRevealed = sameRound && REVEALED.has(prev.phase);
  if (REVEALED.has(next.phase) && !wasRevealed && next.revealed) {
    commands.push({ type: 'reveal', p1: next.revealed[0], p2: next.revealed[1] });
  }
  if (entered('clash') && next.clash) commands.push({ type: 'clash', kind: next.clash.kind, winner: next.clash.winner });
  if (AFTER_ROUND.has(next.phase) && !AFTER_ROUND.has(prev?.phase ?? 'intro')) commands.push({ type: 'reset' });
  if (entered('ended') && next.celebrate !== null) {
    commands.push({ type: 'setScene', scene: 'arena' }, { type: 'celebrate', winner: next.celebrate });
  }
  return commands;
}
