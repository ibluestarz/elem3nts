import { ELEMENTS, type Element } from '../../domain/index.ts';
import { ELEMENT_NAMES } from '../input/keys.ts';
import { useScene } from '../scene/sceneContext.ts';
import './ElementPicks.css';

interface ElementPicksProps {
  readonly compact: boolean;
  /** Choix verrouillé : les zones s'effacent et ne réagissent plus (maquette : opacité 0,35). */
  readonly locked: boolean;
  /**
   * Élément choisi, marqué pour son joueur ; `null` quand il ne doit pas paraître (tour par tour : le choix de
   * Joueur 1 reste caché jusqu'à la révélation).
   */
  readonly pick: Element | null;
  /** Touche affichée dans la rangée de bureau (en ligne) ; absente en tour par tour. */
  readonly keyLabels?: Readonly<Record<string, string>>;
  readonly onChoose: (element: Element) => void;
}

/**
 * Choix d'un élément au pointeur ou au toucher : zones posées sur les éléments 3D quand la scène les situe
 * (maquette `trinTaps`), sinon (repli D33, scène pas encore mesurée) rangée de boutons. Commun à l'arène en
 * ligne (PFC-016) et au tour par tour local (PFC-025).
 */
export function ElementPicks({ compact, locked, pick, keyLabels, onChoose }: ElementPicksProps) {
  const scene = useScene();
  const tapClass = (base: string, element: Element) =>
    [base, locked && `${base}--locked`, pick === element && `${base}--chosen`].filter(Boolean).join(' ');
  const choose = (element: Element) => () => {
    onChoose(element);
  };

  if (scene.status === 'ready' && scene.trinity.length > 0) {
    return scene.trinity.map((point, index) => {
      const element = ELEMENTS[index];
      if (!element) return null;
      return (
        <button
          key={element}
          type="button"
          className={tapClass('arena-tap', element)}
          style={{
            left: `${String(point.x - point.r)}px`,
            top: `${String(point.y - point.r)}px`,
            width: `${String(point.r * 2)}px`,
            height: `${String(point.r * 2)}px`,
          }}
          aria-pressed={pick === element}
          aria-disabled={locked}
          aria-keyshortcuts={keyLabels?.[element]}
          onClick={choose(element)}
        >
          <span className="arena-tap__name">{ELEMENT_NAMES[element]}</span>
        </button>
      );
    });
  }

  return (
    <div className={compact ? 'arena-picks arena-picks--compact' : 'arena-picks'} role="group" aria-label="Votre élément">
      {ELEMENTS.map((element) => (
        <button
          key={element}
          type="button"
          className={tapClass('arena-pick', element)}
          aria-pressed={pick === element}
          aria-disabled={locked}
          aria-keyshortcuts={keyLabels?.[element]}
          onClick={choose(element)}
        >
          <span className={`arena-pick__gem arena-pick__gem--${element}`} aria-hidden="true" />
          <span className="arena-pick__name">{ELEMENT_NAMES[element]}</span>
          {!compact && keyLabels && <span className="arena-pick__key">{keyLabels[element] ?? ''}</span>}
        </button>
      ))}
    </div>
  );
}
