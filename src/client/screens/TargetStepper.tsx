import { useId, type KeyboardEvent, type Ref } from 'react';
import { TARGET_MAX, TARGET_MIN, type TargetInputError } from '../../domain/index.ts';
import { pointsLine, targetErrorMessage } from '../copy.ts';
import './TargetStepper.css';

interface TargetStepperProps {
  readonly target: number;
  readonly draft: string;
  readonly error: TargetInputError | null;
  readonly onDraft: (text: string) => void;
  readonly onTarget: (value: number) => void;
  readonly onStep: (delta: 1 | -1) => void;
  readonly inputRef?: Ref<HTMLInputElement>;
}

/**
 * Score cible de la maquette (−, valeur, +, dix pastilles). La valeur est un champ éditable
 * transparent posé sur le texte de la maquette : rendu identique, saisie libre validée sans arrondi.
 */
export function TargetStepper({ target, draft, error, onDraft, onTarget, onStep, inputRef }: TargetStepperProps) {
  const lineId = useId();
  const errorId = useId();

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const moves: Readonly<Record<string, () => void>> = {
      ArrowUp: () => {
        onStep(1);
      },
      ArrowDown: () => {
        onStep(-1);
      },
      Home: () => {
        onTarget(TARGET_MIN);
      },
      End: () => {
        onTarget(TARGET_MAX);
      },
      Escape: () => {
        onTarget(target);
      },
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      move();
    }
  };

  return (
    <div className="stepper">
      <div className="stepper__row">
        <div className="stepper__legend">
          <label className="panel-label" htmlFor={`${lineId}-input`}>
            Score cible
          </label>
          <div className="stepper__line" id={lineId}>
            {pointsLine(target)}
          </div>
        </div>
        <div className="stepper__controls">
          <button
            type="button"
            className="stepper__step"
            aria-label="Diminuer le score cible"
            aria-disabled={target <= TARGET_MIN}
            onClick={() => {
              onStep(-1);
            }}
          >
            −
          </button>
          <span className="stepper__value">
            <span className="stepper__mirror" aria-hidden="true">
              {draft}
            </span>
            <input
              ref={inputRef}
              id={`${lineId}-input`}
              className="stepper__input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              role="spinbutton"
              aria-valuemin={TARGET_MIN}
              aria-valuemax={TARGET_MAX}
              aria-valuenow={target}
              aria-valuetext={pointsLine(target)}
              aria-invalid={error !== null}
              aria-describedby={error ? errorId : lineId}
              maxLength={3}
              value={draft}
              onChange={(event) => {
                onDraft(event.target.value);
              }}
              onKeyDown={onKeyDown}
            />
          </span>
          <button
            type="button"
            className="stepper__step"
            aria-label="Augmenter le score cible"
            aria-disabled={target >= TARGET_MAX}
            onClick={() => {
              onStep(1);
            }}
          >
            +
          </button>
        </div>
      </div>
      {error && (
        <p className="stepper__error" id={errorId} role="alert">
          {targetErrorMessage(error)}
        </p>
      )}
      <div className="stepper__pips" role="group" aria-label="Score cible rapide">
        {Array.from({ length: TARGET_MAX }, (_, index) => {
          const value = index + 1;
          return (
            <button
              key={value}
              type="button"
              className="stepper__pip"
              aria-label={`Score cible ${String(value)}`}
              aria-pressed={value === target && error === null}
              onClick={() => {
                onTarget(value);
              }}
            >
              <span className={value <= target ? 'stepper__gem stepper__gem--on' : 'stepper__gem'} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
