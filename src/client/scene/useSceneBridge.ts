import { useEffect, useLayoutEffect, useRef } from 'react';
import type { GameState } from '../state/game.ts';
import type { Quality } from '../state/preferences.ts';
import { sceneCommands, type SceneCommand, type SceneScreen, type SceneView } from './commands.ts';
import type { Engine } from './engine.js';

/** Projection de l'état du jeu pour la scène : verrous seulement, choix après révélation. */
export function sceneViewOf(screen: SceneScreen, game: GameState): SceneView {
  const { match, play } = game;
  // Tour par tour : le voile masque la scène, pour qui la manche reste en sélection (verrou de Joueur 1 conservé
  // jusqu'au tour de Joueur 2, aucune remise à zéro entre les deux tours).
  const phase = game.phase === 'gate' ? 'selecting' : game.phase;
  const revealedPhase = phase === 'reveal' || phase === 'clash' || phase === 'result';
  const result = match?.result;
  return {
    screen,
    phase,
    matchId: match?.id ?? null,
    round: game.round,
    locked: [game.selection[0] !== null, game.selection[1] !== null],
    revealed: revealedPhase ? game.revealed : null,
    // Place « gagnante » de l'effet : celle de la maquette (0 pour les effets symétriques).
    clash: play && revealedPhase ? { kind: play.round.kind, winner: play.round.winner ?? 0 } : null,
    celebrate: result?.status === 'won' ? result.winner : result?.status === 'draw' ? -1 : null,
  };
}

function apply(engine: Engine, command: SceneCommand): void {
  switch (command.type) {
    case 'setScene':
      engine.setScene(command.scene);
      return;
    case 'reset':
      engine.reset();
      return;
    case 'setLock':
      engine.setLock(command.player, command.locked);
      return;
    case 'reveal':
      engine.reveal(command.p1, command.p2);
      return;
    case 'clash':
      // Rappels d'impact et de fin ignorés : le reducer reste l'autorité (SPEC cycle).
      engine.clash(command.kind, command.winner);
      return;
    case 'celebrate':
      engine.celebrate(command.winner);
      return;
  }
}

export interface BridgeOptions {
  readonly quality: Quality;
  readonly reducedMotion: boolean;
  readonly compact: boolean;
}

/** Rejoue l'état du jeu dans le moteur 3D, dans le commit du rendu ; sans moteur, ne fait rien. */
export function useSceneBridge(engine: Engine | null, view: SceneView, options: BridgeOptions): void {
  const previous = useRef<SceneView | null>(null);

  useLayoutEffect(() => {
    if (!engine) {
      previous.current = null;
      return;
    }
    for (const command of sceneCommands(previous.current, view)) apply(engine, command);
    previous.current = view;
  }, [engine, view]);

  useEffect(() => {
    engine?.setQuality(options.quality);
  }, [engine, options.quality]);
  useEffect(() => {
    engine?.setReduced(options.reducedMotion);
  }, [engine, options.reducedMotion]);
  useEffect(() => {
    engine?.setMobile(options.compact);
  }, [engine, options.compact]);
}
