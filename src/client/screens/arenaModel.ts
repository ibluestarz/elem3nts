import type { Element, Match, Scores, Trophies } from '../../domain/index.ts';
import type { Banner, PlayerNames } from '../copy.ts';
import { PLAYER_NAMES } from '../input/keys.ts';
import type { DemoPhase } from '../state/demo.ts';
import { trophiesWon, type Phase } from '../state/game.ts';

/** Statut d'un joueur sous son score : texte et teinte (`locked` or, un élément révélé, ou gris). */
export interface HudStatus {
  readonly text: string;
  readonly tone: 'locked' | Element | null;
}

export const NO_STATUS: HudStatus = Object.freeze({ text: '', tone: null });

/**
 * Ce que l'arène affiche, quel que soit le mode : le cycle local (`state/game.ts`) et la vérité du
 * serveur en ligne (`online/game.ts`) s'y projettent. Paires dans l'ordre d'affichage : gauche, droite.
 * L'arène ne calcule rien : scores, résultats et échéances y arrivent déjà décidés.
 */
export interface ArenaModel {
  /** Phase affichée (`data-phase`) : vocabulaire du cycle local (D09), ou de la démo (PFC-026). */
  readonly phase: Phase | DemoPhase;
  readonly names: PlayerNames;
  readonly scores: Scores;
  /** Variations de la manche, montrées depuis l'impact ; `null` sinon. */
  readonly deltas: readonly [number, number] | null;
  readonly statuses: readonly [HudStatus, HudStatus];
  /** Manche en cours ou dernière jouée (1 au minimum à l'écran). */
  readonly round: number;
  readonly target: number;
  /** Mort subite annoncée dans la partie (D05). */
  readonly sudden: boolean;
  /** Échéance de la sélection sur l'horloge locale ; décompte actif seulement en `selecting`. */
  readonly deadline: number | null;
  readonly banner: Banner | null;
  /** Annonce polie d'un événement de la manche (une seule région live). */
  readonly announcement: string;
}

/** Titre et sous-titre de fin de partie (maquette `endTitle`, `endSub`). */
export interface Verdict {
  readonly title: string;
  readonly sub: string;
}

/** Fin d'une partie locale (maquette, mode local). */
export function localVerdict(match: Match): Verdict {
  if (match.result.status === 'won') {
    return { title: 'Victoire', sub: `${PLAYER_NAMES[match.result.winner]} remporte la partie` };
  }
  return { title: 'Match nul', sub: 'Les deux joueurs atteignent la cible ensemble' };
}

/** Contenu de l'écran de fin d'une partie locale : Joueur 1 à gauche, trophées de la session (D32). */
export function localEndProps(match: Match, trophies: Trophies) {
  return { verdict: localVerdict(match), names: PLAYER_NAMES, scores: match.scores, trophies, won: trophiesWon(match), matchId: match.id };
}
