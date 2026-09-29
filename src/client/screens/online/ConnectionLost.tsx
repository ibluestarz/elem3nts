import { useEffect, useId, useRef, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap.ts';
import { now } from '../../state/clock.ts';
import './ConnectionLost.css';

/**
 * Cause affichée : `self`, son propre lien coupé et en cours de reprise ; `opponent`, l'adversaire
 * absent (partie en pause côté serveur, D15).
 */
export type LostKind = 'self' | 'opponent';

interface ConnectionLostProps {
  /** `null` : fermé (sortie animée). */
  readonly kind: LostKind | null;
  /** Nom de l'adversaire (« Joueur 1/2 », D18). */
  readonly opponent: string;
  /** Échéance de reconnexion publiée par le serveur, sur l'horloge locale ; `null` si inconnue. */
  readonly deadline: number | null;
  readonly onRetry: () => void;
  readonly onQuit: () => void;
}

/** Durée d'affichage minimale de « Reconnexion… » : une reprise instantanée ne clignote pas (maquette : 1,5 s). */
export const RETRY_MIN_MS = 700;
/** Durée de la sortie animée (jeton `--duration-base`). */
const LEAVE_MS = 250;

/** Secondes restantes avant `deadline` (arrondi supérieur, jamais négatif), relues quatre fois par seconde. */
function useSecondsLeft(deadline: number | null): number | null {
  const read = () => (deadline === null ? null : Math.max(0, Math.ceil((deadline - now()) / 1000)));
  const [seconds, setSeconds] = useState(read);
  useEffect(() => {
    const update = () => {
      setSeconds(deadline === null ? null : Math.max(0, Math.ceil((deadline - now()) / 1000)));
    };
    update();
    if (deadline === null) return undefined;
    const timer = window.setInterval(update, 250);
    return () => {
      window.clearInterval(timer);
    };
  }, [deadline]);
  return seconds;
}

/**
 * Cause montée à l'écran : « Reconnexion… » reste au moins `RETRY_MIN_MS` (une reprise instantanée ne
 * clignote pas), puis le dialogue fermé reste monté le temps de sa sortie animée (`leaving`).
 */
function useShownKind(kind: LostKind | null): { readonly shown: LostKind | null; readonly leaving: boolean } {
  const [view, setView] = useState<{ readonly shown: LostKind | null; readonly leaving: boolean }>({ shown: kind, leaving: false });
  const since = useRef(kind === 'self' ? now() : 0);
  useEffect(() => {
    const { shown, leaving } = view;
    if (kind === shown && !leaving) return undefined;
    if (kind !== null) {
      // Réouverture pendant la sortie, ou changement de cause : « Reconnexion… » s'affiche aussitôt,
      // l'autre cause après la durée minimale de « Reconnexion… ».
      if (kind === 'self') since.current = now();
      const hold = kind !== 'self' && shown === 'self' ? Math.max(0, since.current + RETRY_MIN_MS - now()) : 0;
      if (hold === 0) {
        setView({ shown: kind, leaving: false });
        return undefined;
      }
      const timer = window.setTimeout(() => {
        setView({ shown: kind, leaving: false });
      }, hold);
      return () => {
        window.clearTimeout(timer);
      };
    }
    if (shown === null) return undefined;
    if (!leaving) {
      const hold = shown === 'self' ? Math.max(0, since.current + RETRY_MIN_MS - now()) : 0;
      if (hold === 0) {
        setView({ shown, leaving: true });
        return undefined;
      }
      const timer = window.setTimeout(() => {
        setView({ shown, leaving: true });
      }, hold);
      return () => {
        window.clearTimeout(timer);
      };
    }
    const timer = window.setTimeout(() => {
      setView({ shown: null, leaving: false });
    }, LEAVE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [kind, view]);
  return view;
}

/**
 * « Connexion interrompue » (maquette `isLost`), par-dessus l'arène ou l'écran de la room : son lien en
 * reprise (« Reconnexion… », textes de la maquette) ou l'adversaire absent (« Joueur N ne répond plus »,
 * partie en pause, décompte de l'échéance publiée par le serveur, D42). « Réessayer » relance la reprise
 * ou resynchronise le lien ; « Quitter la partie » quitte la room.
 *
 * Accessibilité : dialogue d'alerte modal, focus sur « Réessayer » puis rendu à l'élément d'origine,
 * Tab gardé dans le dialogue ; le décompte n'est pas annoncé à chaque seconde (lu à la demande).
 */
export function ConnectionLost({ kind, opponent, deadline, onRetry, onQuit }: ConnectionLostProps) {
  const { shown, leaving } = useShownKind(kind);
  const seconds = useSecondsLeft(shown === 'opponent' ? deadline : null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const subId = useId();
  const open = shown !== null;
  useFocusTrap(dialogRef, open);
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    retryRef.current?.focus();
    return () => {
      // Origine disparue entre-temps (zone de choix d'une phase finie) : titre de l'écran plutôt que <body>.
      const back = previous?.isConnected ? previous : document.querySelector<HTMLElement>('[data-focus-target]');
      back?.focus({ preventScroll: true });
    };
  }, [open]);

  if (shown === null) return null;
  const self = shown === 'self';
  return (
    <div className={leaving ? 'lost lost--leaving' : 'lost'} data-lost={shown}>
      <div className="lost__card" ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={subId}>
        <p className="lost__kicker">Connexion interrompue</p>
        <h2 className={self ? 'lost__title' : 'lost__title lost__title--fit'} id={titleId} key={shown}>
          {self ? 'Reconnexion…' : `${opponent} ne répond plus`}
        </h2>
        <p className="lost__sub" id={subId}>
          {self ? (
            'Tentative de reconnexion au serveur de partie.'
          ) : (
            <>
              {/* Espace avant le saut de ligne : la description accessible garde « pause. Les ». */}
              La manche est en pause.{' '}
              <br />
              Les scores sont conservés encore{' '}
              <span className="lost__count" aria-hidden="true">
                {`${String(seconds ?? 30)} s`}
              </span>
              <span className="visually-hidden">{`${String(seconds ?? 30)} secondes`}</span>.
            </>
          )}
        </p>
        <div className="lost__actions">
          <button type="button" className="lost__retry" ref={retryRef} aria-busy={self} onClick={onRetry}>
            Réessayer
          </button>
          <button type="button" className="lost__quit" onClick={onQuit}>
            Quitter la partie
          </button>
        </div>
      </div>
    </div>
  );
}
