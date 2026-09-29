import { useId } from 'react';
import { TARGET_MAX, TARGET_MIN } from '../../../domain/index.ts';
import { pointsLine } from '../../copy.ts';

interface TargetRowProps {
  readonly target: number;
  /** Absent : réglage de l'hôte affiché en lecture seule (invité). */
  readonly onStep?: (delta: 1 | -1) => void;
}

/** Score cible du mode en ligne (maquette `onHosting`) : ligne « Premier à X points », −, valeur, +. */
export function TargetRow({ target, onStep }: TargetRowProps) {
  const lineId = useId();
  return (
    <div className="target-row">
      <span className="target-row__line" id={lineId} aria-live="polite">
        {pointsLine(target)}
      </span>
      <div className="target-row__controls">
        {onStep && (
          <button
            type="button"
            className="target-row__step"
            aria-label="Diminuer le score cible"
            aria-describedby={lineId}
            aria-disabled={target <= TARGET_MIN}
            onClick={() => {
              onStep(-1);
            }}
          >
            −
          </button>
        )}
        <span key={target} className="target-row__value" aria-hidden="true">
          {target}
        </span>
        {onStep && (
          <button
            type="button"
            className="target-row__step"
            aria-label="Augmenter le score cible"
            aria-describedby={lineId}
            aria-disabled={target >= TARGET_MAX}
            onClick={() => {
              onStep(1);
            }}
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}
