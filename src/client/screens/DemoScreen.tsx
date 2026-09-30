import { useCallback, useMemo, useReducer } from 'react';
import type { PlayerIndex, RoundKind } from '../../domain/index.ts';
import { DEMO_LABELS, resultAnnouncement, roundBanner } from '../copy.ts';
import { ELEMENT_NAMES, PLAYER_NAMES } from '../input/keys.ts';
import { useScene } from '../scene/sceneContext.ts';
import { useSceneBridge, type BridgeOptions } from '../scene/useSceneBridge.ts';
import { now } from '../state/clock.ts';
import {
  DEMO_KINDS,
  demoReducer,
  demoSceneView,
  demoScores,
  initialDemoState,
  isDemoRevealed,
  type DemoState,
} from '../state/demo.ts';
import { useCycle } from '../state/useCycle.ts';
import { ArenaFrame } from './ArenaFrame.tsx';
import { NO_STATUS, type ArenaModel, type HudStatus } from './arenaModel.ts';
import './DemoScreen.css';

interface DemoScreenProps {
  readonly compact: boolean;
  /** Cible affichée sous le décompte (maquette : réglage de la préparation) ; la démo n'en fait rien. */
  readonly target: number;
  readonly sceneOptions: BridgeOptions;
  /** « Accueil » (Échap est traité par la scène de l'application). */
  readonly onHome: () => void;
}

const LOCKED: HudStatus = Object.freeze({ text: 'Choix verrouillé', tone: 'locked' });

const SIDES: readonly (readonly [PlayerIndex, string])[] = [
  [0, 'À gauche'],
  [1, 'À droite'],
];

function statusOf(state: DemoState, player: PlayerIndex): HudStatus {
  const element = state.choices[player];
  // Avant la révélation, seul le verrou est montré (intention de la maquette, D49).
  if (state.phase === 'armed') return element ? LOCKED : NO_STATUS;
  if (isDemoRevealed(state.phase)) return element ? { text: ELEMENT_NAMES[element], tone: element } : { text: 'Aucun choix', tone: null };
  return NO_STATUS;
}

/** Ce que l'arène affiche pendant la démo : tout vient de la résolution du moteur pur. */
function demoModel(state: DemoState, target: number): ArenaModel {
  const { round, phase } = state;
  const scores = demoScores(state);
  const banner = phase === 'result' && round ? roundBanner(round) : null;
  const announcement =
    phase === 'armed' && round
      ? `Démonstration : ${DEMO_LABELS[round.kind]}.`
      : banner
        ? resultAnnouncement(PLAYER_NAMES, state.choices, banner, scores)
        : '';
  return {
    phase,
    names: PLAYER_NAMES,
    scores,
    deltas: banner && round ? round.delta : null,
    statuses: [statusOf(state, 0), statusOf(state, 1)],
    round: 1,
    target,
    sudden: false,
    deadline: null,
    banner,
    announcement,
  };
}

/**
 * Démo des confrontations (maquette `demo`, PFC-026) : l'arène rejoue à la demande chacune des neuf
 * confrontations, avec son effet et son explication, aux échéances de la partie. Elle pilote seule la
 * scène tant qu'elle est affichée ; elle ne touche ni partie, ni session, ni trophée.
 */
export function DemoScreen({ compact, target, sceneOptions, onHome }: DemoScreenProps) {
  const [state, dispatch] = useReducer(demoReducer, undefined, initialDemoState);
  const { engine } = useScene();
  const view = useMemo(() => demoSceneView(state), [state]);
  useSceneBridge(engine, view, sceneOptions);
  // Même horloge que le cycle local ; jamais de tour par tour dans une démo.
  useCycle(state.deadline, false, dispatch);

  const busy = state.phase !== 'idle';
  const run = useCallback((kind: RoundKind) => {
    dispatch({ type: 'run', kind, now: now() });
  }, []);

  const panel = (
    <section className={compact ? 'demo demo--compact' : 'demo'} aria-labelledby="demo-title" data-demo-busy={busy}>
      <div className="demo__head">
        <h3 className="demo__title" id="demo-title">
          Démo · rejouer chaque confrontation
        </h3>
        <div className="demo__controls">
          <span className="demo__side-label" id="demo-side-label">
            Vainqueur
          </span>
          <div className="demo__sides" role="group" aria-labelledby="demo-side-label">
            {SIDES.map(([side, label]) => (
              <button
                key={side}
                type="button"
                className="demo__side"
                aria-pressed={state.side === side}
                onClick={() => {
                  dispatch({ type: 'side', side });
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="demo__home" onClick={onHome}>
            Accueil
          </button>
        </div>
      </div>
      <div className="demo__list" role="group" aria-label="Confrontations">
        {DEMO_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="demo__run"
            // `aria-disabled` et non `disabled` : le bouton cliqué garde le focus pendant l'effet.
            aria-disabled={busy}
            onClick={() => {
              run(kind);
            }}
          >
            {DEMO_LABELS[kind]}
          </button>
        ))}
      </div>
    </section>
  );

  return (
    <ArenaFrame
      compact={compact}
      model={demoModel(state, target)}
      onQuit={onHome}
      title="Démo des confrontations"
      quit="hidden"
      overlay={panel}
    />
  );
}
