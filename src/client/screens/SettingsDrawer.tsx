import { useCallback, useEffect, useRef, useState } from 'react';
import { ELEMENTS, type Element, type PlayerIndex } from '../../domain/index.ts';
import { Switch } from '../components/Switch.tsx';
import { useFocusTrap } from '../hooks/useFocusTrap.ts';
import {
  DEFAULT_BINDINGS,
  ELEMENT_NAMES,
  PLAYER_NAMES,
  DISPLAY_LAYOUTS,
  assignKey,
  keyLabel,
  learnedLabel,
  type DisplayLayout,
  type KeySlot,
  type LayoutLabels,
} from '../input/keys.ts';
import { QUALITIES, updatePreferences, usePreferences, type Quality } from '../state/preferences.ts';
import './panel.css';
import './SettingsDrawer.css';

const QUALITY_LABELS: Readonly<Record<Quality, string>> = { low: 'Basse', medium: 'Moyenne', high: 'Haute' };
const QUALITY_DESCRIPTIONS: Readonly<Record<Quality, string>> = {
  low: 'Basse : sans ombres ni réfraction, particules réduites — pour mobiles modestes.',
  medium: 'Moyenne : sans ombres, eau simplifiée.',
  high: 'Haute : ombres, eau réfractive, particules complètes.',
};

interface Feedback {
  readonly text: string;
  readonly error: boolean;
  /** Change à chaque message pour rejouer le flash, même si le texte est identique. */
  readonly serial: number;
}

const LAYOUT_NAMES: Readonly<Record<DisplayLayout, string>> = { azerty: 'AZERTY', qwerty: 'QWERTY' };

interface SettingsDrawerProps {
  readonly layout: LayoutLabels | null;
  /** Vrai sans Keyboard Layout API : le joueur choisit la disposition affichée (SPEC saisie). */
  readonly layoutUnavailable: boolean;
  readonly onClose: () => void;
}

const slotName = ({ player, element }: KeySlot) => `${PLAYER_NAMES[player]} · ${ELEMENT_NAMES[element]}`;

/** Tiroir Réglages (maquette `isSettings`) : touches, match nul, qualité et mouvements réduits. */
export function SettingsDrawer({ layout, layoutUnavailable, onClose }: SettingsDrawerProps) {
  const preferences = usePreferences();
  const [listening, setListening] = useState<KeySlot | null>(null);
  const [feedback, setFeedback] = useState<Feedback>({ text: '', error: false, serial: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useFocusTrap(panelRef);

  const label = (code: string) => keyLabel(code, layout, preferences.learnedLabels, preferences.displayLayout);
  const say = useCallback((text: string, error = false) => {
    setFeedback((previous) => ({ text, error, serial: previous.serial + 1 }));
  }, []);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Écoute prioritaire (phase de capture) : la touche suivante est réaffectée, jamais traitée ailleurs.
  useEffect(() => {
    if (!listening) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.code === 'Escape') {
        setListening(null);
        say('Modification annulée.');
        return;
      }
      const name = keyLabel(
        event.code,
        layout,
        { ...preferences.learnedLabels, ...learnedEntry(event) },
        preferences.displayLayout,
      );
      const result = assignKey(preferences.bindings, listening, event.code);
      if (!result.ok) {
        say(
          result.reason === 'reserved'
            ? `« ${name} » est réservée ${result.detail}. Choisissez une autre touche.`
            : `Conflit : « ${name} » est déjà attribuée à ${slotName(result.with)}. Choisissez une autre touche.`,
          true,
        );
        return;
      }
      updatePreferences({
        bindings: result.bindings,
        learnedLabels: { ...preferences.learnedLabels, ...learnedEntry(event) },
      });
      setListening(null);
      say(`« ${name} » attribuée à ${slotName(listening)}.`);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [listening, layout, preferences, say]);

  const listen = (player: PlayerIndex, element: Element) => {
    setListening({ player, element });
    say(`Appuyez sur une touche pour ${slotName({ player, element })} — Échap pour annuler.`);
  };

  return (
    <div className="settings">
      <div className="settings__panel" role="dialog" aria-modal="true" aria-labelledby="screen-title" ref={panelRef}>
        <div className="settings__header">
          <div className="settings__titles">
            <p className="panel-label">ELEM3NTS</p>
            <h2 className="panel-heading" id="screen-title" tabIndex={-1} ref={titleRef} data-focus-target>
              Réglages
            </h2>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Fermer
          </button>
        </div>

        <section className="settings__section settings__section--first" aria-labelledby="settings-keys">
          <h3 className="panel-label panel-label--gold" id="settings-keys">
            Commandes · clavier partagé
          </h3>
          <p className="settings__help">Sélectionnez une action, puis appuyez sur la nouvelle touche. Échap annule.</p>
          {layoutUnavailable && (
            <div className="settings__layout">
              <span className="settings__name" id="settings-layout">
                Disposition affichée
              </span>
              <div className="settings__segments" role="group" aria-labelledby="settings-layout">
                {DISPLAY_LAYOUTS.map((displayLayout) => (
                  <button
                    key={displayLayout}
                    type="button"
                    className={
                      preferences.displayLayout === displayLayout
                        ? 'settings__segment settings__segment--on'
                        : 'settings__segment'
                    }
                    aria-pressed={preferences.displayLayout === displayLayout}
                    onClick={() => {
                      if (preferences.displayLayout === displayLayout) return;
                      // Les libellés appris d'un autre clavier ne valent plus : ils sont oubliés.
                      updatePreferences({ displayLayout, learnedLabels: {} });
                      say(`Libellés des touches affichés en ${LAYOUT_NAMES[displayLayout]}.`);
                    }}
                  >
                    {LAYOUT_NAMES[displayLayout]}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="settings__keys" role="group" aria-labelledby="settings-keys">
            <span />
            {PLAYER_NAMES.map((name) => (
              <p className="settings__player" key={name}>
                {name}
              </p>
            ))}
            {ELEMENTS.map((element) => (
              <KeyRow
                key={element}
                element={element}
                listening={listening}
                labels={[label(preferences.bindings[0][element]), label(preferences.bindings[1][element])]}
                onListen={listen}
              />
            ))}
          </div>
          <p
            className={feedback.error ? 'settings__feedback settings__feedback--error' : 'settings__feedback'}
            role="status"
          >
            {feedback.text !== '' && (
              <span key={feedback.serial} className="settings__flash">
                {feedback.text}
              </span>
            )}
          </p>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              updatePreferences({ bindings: DEFAULT_BINDINGS });
              setListening(null);
              say('Touches par défaut rétablies.');
            }}
          >
            Rétablir les touches par défaut
          </button>
        </section>

        <section className="settings__section" aria-labelledby="settings-match">
          <h3 className="panel-label panel-label--gold" id="settings-match">
            Partie
          </h3>
          <div className="settings__toggle">
            <div className="settings__toggle-text">
              <span className="settings__name">Match nul</span>
              <span className="settings__desc" id="settings-draw-desc">
                Si les deux joueurs atteignent la cible ensemble (Feu + Feu), la partie se termine sur un match nul.
                Désactivé : mort subite. N’affecte pas les éléments identiques, qui appliquent toujours leurs règles.
              </span>
            </div>
            <Switch
              label="Match nul"
              checked={preferences.drawEnabled}
              describedBy="settings-draw-desc"
              onChange={(drawEnabled) => {
                updatePreferences({ drawEnabled });
              }}
            />
          </div>
        </section>

        <section className="settings__section settings__section--display" aria-labelledby="settings-display">
          <h3 className="panel-label panel-label--gold" id="settings-display">
            Affichage
          </h3>
          <div className="settings__quality">
            <span className="settings__name" id="settings-quality">
              Qualité visuelle
            </span>
            <div className="settings__segments" role="group" aria-labelledby="settings-quality">
              {QUALITIES.map((quality) => (
                <button
                  key={quality}
                  type="button"
                  className={
                    preferences.quality === quality ? 'settings__segment settings__segment--on' : 'settings__segment'
                  }
                  aria-pressed={preferences.quality === quality}
                  aria-describedby="settings-quality-desc"
                  onClick={() => {
                    updatePreferences({ quality });
                  }}
                >
                  {QUALITY_LABELS[quality]}
                </button>
              ))}
            </div>
            <span className="settings__quality-desc" id="settings-quality-desc">
              {QUALITY_DESCRIPTIONS[preferences.quality]}
            </span>
          </div>
          <div className="settings__toggle">
            <div className="settings__toggle-text">
              <span className="settings__name">Mouvements réduits</span>
              <span className="settings__desc" id="settings-reduced-desc">
                Moins de particules, animations ralenties, pas de tremblement ni de parallaxe. Les éléments et les
                résultats restent reconnaissables.
              </span>
            </div>
            <Switch
              label="Mouvements réduits"
              checked={preferences.reducedMotion}
              describedBy="settings-reduced-desc"
              onChange={(reducedMotion) => {
                updatePreferences({ reducedMotion });
              }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function learnedEntry(event: KeyboardEvent): Record<string, string> {
  const learned = learnedLabel(event);
  return learned === null ? {} : { [event.code]: learned };
}

interface KeyRowProps {
  readonly element: Element;
  readonly listening: KeySlot | null;
  readonly labels: readonly [string, string];
  readonly onListen: (player: PlayerIndex, element: Element) => void;
}

function KeyRow({ element, listening, labels, onListen }: KeyRowProps) {
  return (
    <>
      <span className={`settings__element element-${element}`}>{ELEMENT_NAMES[element]}</span>
      {([0, 1] as const).map((player) => {
        const active = listening?.player === player && listening.element === element;
        const shown = active ? 'Appuyez…' : labels[player];
        return (
          <button
            key={player}
            type="button"
            className={active ? 'settings__key settings__key--listening' : 'settings__key'}
            aria-label={`${PLAYER_NAMES[player]}, ${ELEMENT_NAMES[element]} : ${active ? 'en attente d’une touche' : shown}`}
            aria-pressed={active}
            onClick={() => {
              onListen(player, element);
            }}
          >
            {shown}
          </button>
        );
      })}
    </>
  );
}
