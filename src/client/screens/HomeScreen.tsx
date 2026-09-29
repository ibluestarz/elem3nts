import { useEffect, useRef } from 'react';
import './HomeScreen.css';

export type HomeAction = 'local' | 'online' | 'settings' | 'rules' | 'demo' | 'notes';

interface HomeScreenProps {
  readonly compact: boolean;
  readonly onAction: (action: HomeAction) => void;
  /** Bouton à refocaliser au retour d'un écran ouvert depuis l'accueil (restitution du focus). */
  readonly returnFocus: HomeAction | null;
}

const NAV: readonly (readonly [HomeAction, string])[] = [
  ['local', 'Jouer en local'],
  ['online', 'Jouer en ligne'],
  ['settings', 'Réglages'],
  ['rules', 'Règles du jeu'],
];

/** Accueil de la maquette : titre, quatre modes, raccourci Espace (bureau) ou bouton (téléphone). */
export function HomeScreen({ compact, onAction, returnFocus }: HomeScreenProps) {
  const refs = useRef(new Map<HomeAction, HTMLButtonElement>());

  useEffect(() => {
    if (returnFocus) refs.current.get(returnFocus)?.focus();
  }, [returnFocus]);

  const button = (action: HomeAction, label: string, className: string) => (
    <button
      key={action}
      type="button"
      className={className}
      ref={(node) => {
        if (node) refs.current.set(action, node);
        else refs.current.delete(action);
      }}
      onClick={() => {
        onAction(action);
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="home screen-enter">
      <div className="home__main">
        <div className="home__intro">
          <p className="home__eyebrow">Un duel élémentaire</p>
          <h1 className="home__title" id="screen-title">
            ELEM<span className="home__three">3</span>NTS
          </h1>
          <p className="home__lede">Le Feu, l’Eau et la Plante s’affrontent au cœur de l’arène oubliée.</p>
        </div>
        <div className="home__actions">
          <nav className="home__nav" aria-label="Modes de jeu">
            {NAV.map(([action, label]) => button(action, label, 'home__mode'))}
          </nav>
          {compact ? (
            button('local', 'Touchez pour jouer', 'home__tap')
          ) : (
            <p className="home__hint">
              Appuyez sur <kbd className="home__key">Espace</kbd> pour jouer en local
            </p>
          )}
        </div>
      </div>
      <div className="home__links">
        {button('demo', 'Démo des confrontations', 'home__link')}
        {button('notes', 'Notes de conception', 'home__link')}
      </div>
    </div>
  );
}
