import { useLayoutEffect, useRef } from 'react';
import { now } from '../state/clock.ts';
import { CYCLE_MS } from '../state/game.ts';
import './RoundTimer.css';

/** Périmètre de l'anneau (r = 34) : `stroke-dasharray` de la maquette. */
const RING = 213.6;
const WINDOW_S = CYCLE_MS.selection / 1000;
/** Pas de rafraîchissement de la maquette (`setInterval` de 50 ms). */
const STEP_MS = 50;
/** Sous ce seuil, le chiffre passe à l'or vif (maquette). */
const URGENT_S = 1.5;

interface RoundTimerProps {
  readonly deadline: number | null;
  /** Décompte actif pendant la sélection ; sinon anneau figé et masqué (fondu de la maquette). */
  readonly active: boolean;
  /** Secondes affichées hors sélection : 5 avant la première manche, 0 après une révélation. */
  readonly idleSeconds: number;
  /** Présentation téléphone de la maquette : anneau de 58 px, traits plus épais, chiffre de 24 px. */
  readonly compact?: boolean;
}

/**
 * Minuteur de sélection (maquette : anneau SVG 78 px, chiffre Cinzel). Mis à jour directement dans
 * le DOM toutes les 50 ms, sans rendu React par pas ; nettoyé au démontage.
 */
export function RoundTimer({ deadline, active, idleSeconds, compact = false }: RoundTimerProps) {
  const ringRef = useRef<SVGCircleElement>(null);
  const numberRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const ring = ringRef.current;
    const number = numberRef.current;
    if (!ring || !number) return undefined;
    const paint = (seconds: number) => {
      ring.style.strokeDashoffset = String(RING * (1 - seconds / WINDOW_S));
      number.textContent = String(Math.ceil(seconds));
      number.classList.toggle('round-timer__number--urgent', active && seconds <= URGENT_S);
    };
    if (!active || deadline === null) {
      paint(idleSeconds);
      return undefined;
    }
    const update = () => {
      const seconds = Math.max(0, Math.min(WINDOW_S, (deadline - now()) / 1000));
      paint(seconds);
      return seconds;
    };
    update();
    const interval = window.setInterval(() => {
      if (update() <= 0) window.clearInterval(interval);
    }, STEP_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [active, deadline, idleSeconds]);

  const size = compact ? 58 : 78;
  const className = ['round-timer', active && 'round-timer--active', compact && 'round-timer--compact'].filter(Boolean).join(' ');
  return (
    <div className={className} aria-hidden={!active}>
      <svg className="round-timer__ring" width={size} height={size} viewBox="0 0 78 78" aria-hidden="true">
        <circle cx="39" cy="39" r="34" fill="none" stroke="rgba(233,227,214,.14)" strokeWidth={compact ? '2.5' : '2'} />
        <circle
          ref={ringRef}
          className="round-timer__progress"
          cx="39"
          cy="39"
          r="34"
          fill="none"
          stroke="#d8b878"
          strokeWidth={compact ? '3' : '2.5'}
          strokeLinecap="round"
          strokeDasharray="213.6"
        />
      </svg>
      <div className="round-timer__number" ref={numberRef} role="timer" aria-label="Secondes restantes" />
    </div>
  );
}
