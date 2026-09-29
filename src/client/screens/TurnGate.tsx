import { useEffect, useId, useRef } from 'react';
import { turnGateCopy } from '../copy.ts';
import { useFocusTrap } from '../hooks/useFocusTrap.ts';
import './TurnGate.css';

interface TurnGateProps {
  readonly round: number;
  /** Joueur dont c'est le tour. */
  readonly player: 0 | 1;
  /** Joueur 1 a choisi à temps (texte du voile de Joueur 2) ; jamais l'élément lui-même. */
  readonly firstLocked: boolean;
  readonly onReady: () => void;
}

/**
 * Voile opaque du tour par tour sur un seul téléphone (maquette `gate`, PFC-025) : il masque tout l'écran
 * pendant le passage de l'appareil ; le joueur suivant se déclare prêt pour ouvrir sa fenêtre de 5 s.
 * Dialogue modal : focus sur son unique action, Tab gardé dedans ; Échap quitte la partie (Stage).
 */
export function TurnGate({ round, player, firstLocked, onReady }: TurnGateProps) {
  const copy = turnGateCopy(round, player, firstLocked);
  const dialogRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const subId = useId();
  useFocusTrap(dialogRef);

  useEffect(() => {
    buttonRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="turn-gate" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={subId}>
      <span className="turn-gate__gem" aria-hidden="true" />
      <p className="turn-gate__label">{copy.label}</p>
      <h3 className="turn-gate__title" id={titleId}>
        {copy.title}
      </h3>
      <p className="turn-gate__sub" id={subId}>
        {copy.sub}
      </p>
      <button type="button" className="btn-gold turn-gate__go" ref={buttonRef} onClick={onReady}>
        {copy.button}
      </button>
    </div>
  );
}
