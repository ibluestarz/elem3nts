import { useEffect, useRef, type ReactNode } from 'react';
import type { Scores, Trophies } from '../../domain/index.ts';
import type { PlayerNames } from '../copy.ts';
import './EndScreen.css';

import type { Verdict } from './arenaModel.ts';

/**
 * Bouton « Rejouer » : `idle` (disponible), `pending` (confirmation envoyée) ou `waiting` (confirmée,
 * l'adversaire doit encore confirmer, D12). Le mode local ne connaît que `idle`.
 */
export type ReplayState =
  | { readonly status: 'idle' }
  | { readonly status: 'pending' }
  | { readonly status: 'waiting'; readonly label: string };

const IDLE_REPLAY: ReplayState = { status: 'idle' };

interface EndScreenProps {
  readonly compact: boolean;
  readonly verdict: Verdict;
  /** Noms, scores, trophées et gains dans l'ordre d'affichage (gauche, droite). */
  readonly names: PlayerNames;
  readonly scores: Scores;
  /** Trophées de la session, partie terminée comprise (D13, D14). */
  readonly trophies: Trophies;
  readonly won: readonly [boolean, boolean];
  readonly replay?: ReplayState;
  /**
   * Information de revanche en ligne (l'adversaire veut rejouer, ou est absent), posée au-dessus des
   * réglages et annoncée poliment ; absente en local (aucune région ajoutée à la mise en page).
   */
  readonly notice?: string | null | undefined;
  /** Contenu ajouté au-dessus des actions (réglages de la revanche en ligne). */
  readonly children?: ReactNode;
  readonly matchId?: string | undefined;
  readonly onReplay: () => void;
  readonly onHome: () => void;
}

/**
 * Écran « Fin de partie » (maquette `isEnd`), complété des trophées de la session (SPEC, D32) :
 * seule la ligne des trophées s'ajoute à la maquette, sous les scores. En ligne, « Rejouer » attend
 * la confirmation de l'adversaire et l'hôte peut changer les réglages de la revanche (SPEC).
 */
export function EndScreen(props: EndScreenProps) {
  const { compact, verdict, names, scores, trophies, won, replay = IDLE_REPLAY, notice, children, matchId, onReplay, onHome } = props;
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const waiting = replay.status === 'waiting';
  const replayClass = ['end__replay', waiting && 'end__replay--waiting'].filter(Boolean).join(' ');

  return (
    <div className="end screen-enter" data-match-id={matchId}>
      <div className="end__summary">
        <p className="end__label">Fin de partie</p>
        {/* Le titre focalisé (« Victoire ») est complété par le vainqueur à l'annonce (PFC-021). */}
        <h2 className="end__title" id="screen-title" tabIndex={-1} ref={titleRef} data-focus-target aria-describedby="end-verdict-sub">
          {verdict.title}
        </h2>
        <p className="end__sub" id="end-verdict-sub">
          {verdict.sub}
        </p>
        <div className="end__scores" role="group" aria-label="Score final">
          <div className="end__player">
            <span className="end__name">{names[0]}</span>
            <span className="end__score">{scores[0]}</span>
          </div>
          <span className="end__separator" aria-hidden="true" />
          <div className="end__player">
            <span className="end__name">{names[1]}</span>
            <span className="end__score">{scores[1]}</span>
          </div>
        </div>
        <div className="end__trophies" role="group" aria-labelledby="end-trophies-label">
          <span className="end__trophies-label" id="end-trophies-label">
            Trophées de la session
          </span>
          <div className="end__trophies-row">
            {([0, 1] as const).map((player) => (
              <span className="end__trophy" key={player}>
                <span className="visually-hidden">{`${names[player]} : `}</span>
                <span className="end__trophy-mark" aria-hidden="true" />
                <span className="end__trophy-count">{trophies[player]}</span>
                {won[player] && (
                  <span className="end__trophy-gain">
                    <span aria-hidden="true">+1</span>
                    <span className="visually-hidden"> (gagné cette partie)</span>
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="end__footer">
        {children}
        <div className="end__actions">
          <button
            type="button"
            className={replayClass}
            aria-disabled={replay.status === 'idle' ? undefined : true}
            aria-busy={replay.status === 'pending' ? true : undefined}
            onClick={onReplay}
          >
            {waiting ? (
              <span className="end__replay-label" key="waiting">
                <span className="end__check" aria-hidden="true" />
                {replay.label}
              </span>
            ) : (
              'Rejouer'
            )}
          </button>
          <button type="button" className="end__home" onClick={onHome}>
            Retour à l’accueil
          </button>
        </div>
        {notice !== undefined && (
          // Région polie présente dès l'affichage : l'annonce est lue quand l'information apparaît.
          <div className="end__notice-region" role="status">
            {notice !== null && (
              <p className="end__notice" key={notice}>
                <span className="end__notice-gem" aria-hidden="true" />
                {notice}
              </p>
            )}
          </div>
        )}
        {!compact && <p className="end__hint">Espace · Rejouer   ·   Échap · Accueil</p>}
      </div>
    </div>
  );
}
