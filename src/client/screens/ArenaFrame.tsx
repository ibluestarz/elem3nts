import { useEffect, useRef, type ReactNode } from 'react';
import { deltaLabel } from '../copy.ts';
import type { ArenaModel, HudStatus } from './arenaModel.ts';
import { RoundTimer } from './RoundTimer.tsx';
import './Arena.css';

interface ArenaFrameProps {
  readonly compact: boolean;
  readonly model: ArenaModel;
  readonly onQuit: () => void;
  /** Bureau, entre le centre et « Quitter » : étiquettes, légendes, état de la connexion. */
  readonly desktopExtras?: ReactNode;
  /** Téléphone, sous l'en-tête : indication de la phase. */
  readonly compactExtras?: ReactNode;
  /** Au-dessus de la bannière : zones à toucher posées sur les éléments 3D (maquette `trinTaps`). */
  readonly overlay?: ReactNode;
  /** Partie affichée (`data-match-id`), pour les outils de test et de diagnostic. */
  readonly matchId?: string | undefined;
}

const statusClass = (base: string, status: HudStatus) => (status.tone ? `${base} ${base}--${status.tone}` : base);

/**
 * Arène (maquette `inArena`), commune au jeu local et en ligne : scores, statuts, décompte, manche et
 * bannière, rendus depuis un `ArenaModel` déjà décidé. Chaque mode y ajoute ses propres contrôles.
 */
export function ArenaFrame({ compact, model, onQuit, desktopExtras, compactExtras, overlay, matchId }: ArenaFrameProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { names, scores, deltas, statuses, target, banner, phase } = model;
  const round = Math.max(1, model.round);
  const idleSeconds = phase === 'intro' || phase === 'ready' ? 5 : 0;
  const selecting = phase === 'selecting';

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Un contrôle focalisé qui disparaît avec sa phase (zones de choix en ligne, dialogue de coupure) rend le
  // focus au <body> : il revient au titre de l'arène, point de départ de la navigation clavier (PFC-021).
  useEffect(() => {
    const focused = document.activeElement;
    if (focused === null || focused === document.body) titleRef.current?.focus({ preventScroll: true });
  }, [phase]);

  const delta = (player: 0 | 1, className: string) => {
    const label = deltas ? deltaLabel(deltas[player]) : '';
    const tone = label === '+1' ? ' is-gain' : label === '−1' ? ' is-loss' : '';
    return <span className={`${className}${deltas ? ` ${className}--shown` : ''}${tone}`}>{label}</span>;
  };

  return (
    <div className="arena screen-enter" data-phase={phase} data-match-id={matchId}>
      <h2 className="visually-hidden" id="screen-title" tabIndex={-1} ref={titleRef} data-focus-target>
        {`Arène · manche ${String(round)} · premier à ${String(target)}`}
      </h2>
      <p className="visually-hidden" aria-live="polite">
        {model.announcement}
      </p>
      {compact ? (
        <>
          <div className="arena-m__top">
            {([0, 1] as const).map((player) => (
              <div key={player} className={`arena-m__player arena-m__player--p${String(player + 1)}`}>
                <p className="arena-m__name">{names[player]}</p>
                <div className="arena-m__score-row">
                  <span className="arena-m__score">{scores[player]}</span>
                  {delta(player, 'arena-m__delta')}
                </div>
                <div className={statusClass('arena-m__status', statuses[player])}>
                  {statuses[player].text !== '' && (
                    <span className="arena-m__status-text" key={statuses[player].text}>
                      {statuses[player].text}
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div className="arena-m__center">
              <RoundTimer deadline={model.deadline} active={selecting} idleSeconds={idleSeconds} compact />
              <p className="arena-m__round">{`Manche ${String(round)} · cible ${String(target)}`}</p>
            </div>
          </div>
          {compactExtras}
          <div className="arena-m__actions">
            <button type="button" className="arena-m__quit" onClick={onQuit}>
              Quitter
            </button>
          </div>
        </>
      ) : (
        <>
          {([0, 1] as const).map((player) => {
            const status = statuses[player];
            return (
              <div key={player} className={`arena__player arena__player--p${String(player + 1)}`}>
                <p className="arena__name">{names[player]}</p>
                <div className="arena__score-row">
                  <span className="arena__score">{scores[player]}</span>
                  {delta(player, 'arena__delta')}
                </div>
                <div className={statusClass('arena__status', status)}>
                  <span className="arena__dot" key={status.tone ?? 'open'} />
                  {status.text !== '' && (
                    <span className="arena__status-text" key={status.text}>
                      {status.text}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          <div className="arena__center">
            <RoundTimer deadline={model.deadline} active={selecting} idleSeconds={idleSeconds} />
            <p className="arena__round">{`Manche ${String(round)} · premier à ${String(target)}${model.sudden ? ' · mort subite' : ''}`}</p>
          </div>
          {desktopExtras}
          <button type="button" className="arena__quit" onClick={onQuit}>
            Échap · Quitter
          </button>
        </>
      )}
      <div
        className={['arena__banner', compact && 'arena__banner--compact', !banner && 'arena__banner--hidden']
          .filter(Boolean)
          .join(' ')}
        aria-hidden="true"
      >
        <div className="arena__banner-title">{banner?.title ?? ''}</div>
        <p className="arena__banner-sub">{banner?.sub ?? ''}</p>
      </div>
      {overlay}
    </div>
  );
}
