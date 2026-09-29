import { ELEMENTS, type Element } from '../../../domain/index.ts';
import { ElementPicks } from '../../components/ElementPicks.tsx';
import { Keycap } from '../../components/Keycap.tsx';
import { ELEMENT_NAMES, PLAYER_NAMES } from '../../input/keys.ts';
import { opponentOf } from '../../online/game.ts';
import { ArenaFrame } from '../ArenaFrame.tsx';
import type { ArenaModel } from '../arenaModel.ts';
import './OnlineArena.css';

interface OnlineArenaProps {
  readonly compact: boolean;
  readonly model: ArenaModel;
  /** Sa place (0 = Joueur 1) : nomme l'adversaire dans l'état de la connexion. */
  readonly slot: 0 | 1;
  /** L'adversaire est connecté (présence publiée par le serveur). */
  readonly opponentConnected: boolean;
  /** Son choix de la manche en cours, `null` tant qu'il n'est pas envoyé. */
  readonly pick: Element | null;
  /** Latence médiane mesurée (ms), `null` avant la première mesure. */
  readonly latency: number | null;
  /** Libellés des touches de Joueur 1, utilisées pour sa propre place en ligne (D11, SPEC saisie). */
  readonly keyLabels: Readonly<Record<string, string>>;
  readonly matchId?: string | undefined;
  readonly onChoose: (element: Element) => void;
  readonly onQuit: () => void;
}

/**
 * Arène en ligne (maquette `inArena`, mode `online`) : soi à gauche, l'adversaire à droite, choix par
 * les touches de Joueur 1 ou en touchant un élément (maquette `trinTaps`, bureau compris). Sans scène
 * 3D, les mêmes boutons s'affichent en rangée : la partie reste jouable au pointeur et au toucher.
 */
export function OnlineArena(props: OnlineArenaProps) {
  const { compact, model, slot, opponentConnected, pick, latency, keyLabels, matchId, onChoose, onQuit } = props;
  const selecting = model.phase === 'selecting';
  const locked = model.statuses[0].tone === 'locked';

  const picks = selecting && <ElementPicks compact={compact} locked={locked} pick={pick} keyLabels={keyLabels} onChoose={onChoose} />;

  const opponent = PLAYER_NAMES[opponentOf(slot)];
  return (
    <ArenaFrame
      compact={compact}
      model={model}
      onQuit={onQuit}
      matchId={matchId}
      overlay={picks}
      compactExtras={
        selecting && (
          <p className="arena-m__hint" key={locked ? 'locked' : 'open'}>
            {locked ? 'Choix verrouillé' : 'Touchez un élément'}
          </p>
        )
      }
      desktopExtras={
        <>
          <div className="arena__legend arena__legend--p1">
            <p className="arena__legend-name">{model.names[0]}</p>
            <ul className="arena__keys" aria-label="Vos touches">
              {ELEMENTS.map((element) => (
                <li className="arena__key" key={element}>
                  <Keycap label={keyLabels[element] ?? ''} variant="arena" />
                  <span className={`arena__element element-${element}`}>{ELEMENT_NAMES[element]}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="arena-net">
            <p className={opponentConnected ? 'arena-net__line' : 'arena-net__line arena-net__line--away'}>
              <span className="arena-net__dot" aria-hidden="true" />
              {opponentConnected
                ? `En ligne${latency === null ? '' : ` · ${String(Math.round(latency))} ms`}`
                : `${opponent} déconnecté`}
            </p>
          </div>
        </>
      }
    />
  );
}
