import { useEffect, useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap.ts';
import './panel.css';
import './RulesDialog.css';

interface RulesDialogProps {
  readonly onClose: () => void;
  readonly onNotes: () => void;
}

/** Règles du jeu (maquette `isRules`), conformes à SPEC R01–R12 (D27). */
export function RulesDialog({ onClose, onNotes }: RulesDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useFocusTrap(panelRef);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <div className="rules screen-enter">
      <div className="rules__panel" role="dialog" aria-modal="true" aria-labelledby="screen-title" ref={panelRef}>
        <div className="rules__header">
          <h2 className="panel-heading" id="screen-title" tabIndex={-1} ref={titleRef} data-focus-target>
            Règles du jeu
          </h2>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Fermer
          </button>
        </div>
        <section className="rules__section" aria-labelledby="rules-cycle">
          <h3 className="panel-label panel-label--gold" id="rules-cycle">
            Le cycle
          </h3>
          <ul className="rules__cycle">
            <li>
              <b className="element-water">L’Eau</b> éteint <b className="element-fire">le Feu</b>
            </li>
            <li>
              <b className="element-fire">Le Feu</b> consume <b className="element-plant">la Plante</b>
            </li>
            <li>
              <b className="element-plant">La Plante</b> absorbe <b className="element-water">l’Eau</b>
            </li>
          </ul>
          <p className="rules__text">Le vainqueur de la manche marque 1 point, l’autre ne marque rien.</p>
        </section>
        <section className="rules__section" aria-labelledby="rules-same">
          <h3 className="panel-label panel-label--gold" id="rules-same">
            Éléments identiques · jamais une simple égalité
          </h3>
          <dl className="rules__same">
            <dt className="element-fire">Feu + Feu</dt>
            <dd>Les deux joueurs gagnent 1 point.</dd>
            <dt className="element-water">Eau + Eau</dt>
            <dd>Les deux joueurs perdent 1 point.</dd>
            <dt className="element-plant">Plante + Plante</dt>
            <dd>Le joueur au score le plus faible gagne 1 point. À égalité, rien ne change.</dd>
          </dl>
        </section>
        <section className="rules__section" aria-labelledby="rules-time">
          <h3 className="panel-label panel-label--gold" id="rules-time">
            Le temps · la victoire
          </h3>
          <p className="rules__text rules__text--pretty">
            Chaque manche laisse 5 secondes pour choisir. Les choix restent secrets jusqu’à zéro. Si un seul joueur a
            choisi, il marque 1 point. Le premier à atteindre le score cible (1 à 10) remporte la partie.
          </p>
        </section>
        <button type="button" className="link-button" onClick={onNotes}>
          Hypothèses du prototype (score minimum, égalités…)
        </button>
      </div>
    </div>
  );
}
