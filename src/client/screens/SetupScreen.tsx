import { useEffect, useRef } from 'react';
import { ELEMENTS, type TargetInputError } from '../../domain/index.ts';
import { Keycap } from '../components/Keycap.tsx';
import { ELEMENT_NAMES, PLAYER_NAMES } from '../input/keys.ts';
import { TargetStepper } from './TargetStepper.tsx';
import './panel.css';
import './SetupScreen.css';

interface SetupScreenProps {
  readonly compact: boolean;
  readonly target: number;
  readonly draft: string;
  readonly error: TargetInputError | null;
  /** Libellés affichés des touches, par joueur puis élément. */
  readonly keyLabels: readonly [Readonly<Record<string, string>>, Readonly<Record<string, string>>];
  readonly onDraft: (text: string) => void;
  readonly onTarget: (value: number) => void;
  readonly onStep: (delta: 1 | -1) => void;
  readonly onBack: () => void;
  readonly onEditKeys: () => void;
  readonly onStart: () => void;
  readonly focusInput: number;
  /** Focus à l'ouverture : le titre, ou « Modifier les touches » au retour des réglages. */
  readonly initialFocus?: 'title' | 'keys';
}

/** Préparation d'une partie locale (maquette `isSetup`). */
export function SetupScreen(props: SetupScreenProps) {
  const { compact, error, keyLabels, onBack, onEditKeys, onStart, focusInput, initialFocus = 'title' } = props;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const keysRef = useRef<HTMLButtonElement>(null);

  // Montage seulement : l'origine du retour est lue une fois, comme le titre des autres écrans.
  const firstFocus = useRef(initialFocus);
  useEffect(() => {
    (firstFocus.current === 'keys' ? (keysRef.current ?? titleRef.current) : titleRef.current)?.focus();
  }, []);

  // Une tentative de lancement invalide ramène le focus sur la saisie fautive.
  useEffect(() => {
    if (focusInput > 0) inputRef.current?.focus();
  }, [focusInput]);

  return (
    <div className="setup screen-enter">
      <section className="setup__panel" aria-labelledby="screen-title">
        <div className="setup__header">
          <p className="panel-label">Partie locale · même écran</p>
          <h2 className="setup__title" id="screen-title" tabIndex={-1} ref={titleRef} data-focus-target>
            Préparer le duel
          </h2>
        </div>
        <TargetStepper
          target={props.target}
          draft={props.draft}
          error={error}
          onDraft={props.onDraft}
          onTarget={props.onTarget}
          onStep={props.onStep}
          inputRef={inputRef}
        />
        {compact ? (
          <p className="setup__note">
            Sur un seul téléphone, vous jouez tour par tour : chacun dispose de 5 secondes, puis un voile masque
            l’écran pendant que vous passez l’appareil. Pour un duel simultané, préférez le mode en ligne.
          </p>
        ) : (
          <>
            <div className="setup__players">
              {PLAYER_NAMES.map((name, player) => (
                <div className="setup__player" key={name}>
                  <p className="panel-label">{name}</p>
                  <ul className="setup__keys" aria-label={`Touches de ${name}`}>
                    {ELEMENTS.map((element) => (
                      <li className="setup__key" key={element}>
                        <Keycap label={keyLabels[player]?.[element] ?? ''} />
                        <span className={`setup__element element-${element}`}>{ELEMENT_NAMES[element]}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <button type="button" className="link-button" ref={keysRef} onClick={onEditKeys}>
              Modifier les touches
            </button>
          </>
        )}
        <div className="setup__footer">
          <button type="button" className="btn-ghost btn-ghost--large" onClick={onBack}>
            Retour
          </button>
          <button
            type="button"
            className="btn-gold"
            aria-disabled={error !== null}
            aria-describedby={error !== null ? 'setup-start-blocked' : undefined}
            onClick={onStart}
          >
            Commencer
            {!compact && <span className="btn-gold__hint">· Espace</span>}
          </button>
          {error !== null && (
            <span id="setup-start-blocked" className="visually-hidden">
              Lancement indisponible : corrigez le score cible.
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
