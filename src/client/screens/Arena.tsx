import { ELEMENTS, lockedPlayers, type Element, type PlayerIndex, type Scores } from '../../domain/index.ts';
import { ElementPicks } from '../components/ElementPicks.tsx';
import { Keycap } from '../components/Keycap.tsx';
import { OPENING_TITLE, SUDDEN_BANNER, pointsLine, resultAnnouncement, roundBanner, type Banner } from '../copy.ts';
import { ELEMENT_NAMES, PLAYER_NAMES } from '../input/keys.ts';
import { useScene } from '../scene/sceneContext.ts';
import { displayedScores, type GameState } from '../state/game.ts';
import { ArenaFrame } from './ArenaFrame.tsx';
import { NO_STATUS, type ArenaModel, type HudStatus } from './arenaModel.ts';
import { TurnGate } from './TurnGate.tsx';

interface ArenaProps {
  readonly compact: boolean;
  /** État du cycle ; les choix n'y sont lus qu'une fois révélés. */
  readonly game: GameState;
  readonly keyLabels: readonly [Readonly<Record<string, string>>, Readonly<Record<string, string>>];
  readonly onQuit: () => void;
  /** Tour par tour (PFC-025) : choix au toucher du joueur dont c'est le tour. */
  readonly onChoose: (player: PlayerIndex, element: Element) => void;
  /** Tour par tour : le joueur du voile se déclare prêt. */
  readonly onTurnReady: () => void;
}

function statusOf(game: GameState, player: 0 | 1): HudStatus {
  if (game.phase === 'selecting' || game.phase === 'gate') {
    if (lockedPlayers(game.selection)[player]) return { text: 'Choix verrouillé', tone: 'locked' };
    // Tour par tour (maquette) : le joueur qui n'a pas la main attend, voile compris.
    if (game.turn !== null && (game.phase === 'gate' || game.turn !== player)) return { text: 'En attente', tone: null };
    return { text: 'Choix en cours…', tone: null };
  }
  if ((game.phase === 'reveal' || game.phase === 'clash' || game.phase === 'result') && game.revealed) {
    const element = game.revealed[player];
    return element ? { text: ELEMENT_NAMES[element], tone: element } : { text: 'Aucun choix', tone: null };
  }
  return NO_STATUS;
}

function bannerOf(game: GameState): Banner | null {
  if (game.phase === 'intro' && game.match) return { title: OPENING_TITLE, sub: pointsLine(game.match.settings.target) };
  if (game.phase === 'result' && game.play) return roundBanner(game.play.round);
  if (game.phase === 'sudden') return SUDDEN_BANNER;
  return null;
}

/** Annonce polie d'un événement de la manche : verrous, puis résultat complet (une seule région live). */
function announcementOf(game: GameState, scores: Scores): string {
  // Le voile est un dialogue focalisé : son titre et son texte sont lus avec lui.
  if (game.phase === 'gate') return '';
  if (game.phase === 'selecting' && game.turn !== null) {
    return lockedPlayers(game.selection)[game.turn]
      ? `${PLAYER_NAMES[game.turn]} a verrouillé son choix.`
      : `Manche ${String(game.round)} : ${PLAYER_NAMES[game.turn]}, touchez un élément.`;
  }
  if (game.phase === 'selecting') {
    const locked = lockedPlayers(game.selection);
    const names = PLAYER_NAMES.filter((_, player) => locked[player]);
    return names.length === 0
      ? `Manche ${String(game.round)} : choisissez.`
      : names.length > 1
        ? `${names.join(' et ')} ont verrouillé leur choix.`
        : `${names.join('')} a verrouillé son choix.`;
  }
  if (game.phase === 'result' && game.play && game.revealed) {
    return resultAnnouncement(PLAYER_NAMES, game.revealed, roundBanner(game.play.round), scores);
  }
  if (game.phase === 'sudden') return `${SUDDEN_BANNER.title} : ${SUDDEN_BANNER.sub}.`;
  return '';
}

/** Arène du cycle local, sur clavier partagé : le reducer décide, l'arène affiche. */
function localArenaModel(game: GameState): ArenaModel | null {
  const { match } = game;
  if (!match) return null;
  const scores = displayedScores(game) ?? match.scores;
  return {
    phase: game.phase,
    names: PLAYER_NAMES,
    scores,
    deltas: game.phase === 'result' && game.play ? game.play.round.delta : null,
    statuses: [statusOf(game, 0), statusOf(game, 1)],
    round: game.round,
    target: match.settings.target,
    sudden: game.sudden,
    deadline: game.deadline,
    banner: bannerOf(game),
    announcement: announcementOf(game, scores),
  };
}

/**
 * Arène locale (maquette `inArena`, mode local) : ouverture, sélection sur clavier partagé, révélation
 * et résultat. Les réglages y sont figés ; aucun élément n'est rendu avant la révélation.
 */
export function Arena({ compact, game, keyLabels, onQuit, onChoose, onTurnReady }: ArenaProps) {
  const { trinity } = useScene();
  const model = localArenaModel(game);
  if (!model) return null;
  const { turn } = game;
  const turnSelecting = game.phase === 'selecting' && turn !== null;

  // Tour par tour : voile opaque pendant le passage de l'appareil, puis choix au toucher du joueur dont c'est
  // le tour. Son choix n'est jamais marqué (`pick` nul) : il reste caché jusqu'à la révélation.
  const overlay =
    game.phase === 'gate' && turn !== null ? (
      <TurnGate key={turn} round={game.round} player={turn} firstLocked={game.selection[0] !== null} onReady={onTurnReady} />
    ) : (
      turnSelecting && (
        <ElementPicks
          compact={compact}
          locked={false}
          pick={null}
          onChoose={(element) => {
            onChoose(turn, element);
          }}
        />
      )
    );

  return (
    <ArenaFrame
      compact={compact}
      model={model}
      onQuit={onQuit}
      matchId={game.match?.id}
      overlay={overlay}
      compactExtras={turnSelecting && <p className="arena-m__hint">{`${PLAYER_NAMES[turn]} · touchez un élément`}</p>}
      desktopExtras={
        <>
          {/* Étiquettes sous les éléments 3D (maquette `trinLabels`) : décoratives, les légendes portent les noms ;
              en tour par tour, les zones à toucher les portent déjà. */}
          {turn === null &&
            trinity.map((point, index) => {
              const element = ELEMENTS[index];
              if (!element) return null;
              return (
                <div
                  key={element}
                  className={game.phase === 'selecting' ? 'arena__trin arena__trin--shown' : 'arena__trin'}
                  style={{ left: `${String(point.x)}px`, top: `${String(point.y + point.r * 0.85)}px` }}
                  aria-hidden="true"
                >
                  {ELEMENT_NAMES[element]}
                </div>
              );
            })}
          {([0, 1] as const).map((player) => (
            <div key={player} className={`arena__legend arena__legend--p${String(player + 1)}`}>
              <p className="arena__legend-name">{PLAYER_NAMES[player]}</p>
              <ul className="arena__keys" aria-label={`Touches de ${PLAYER_NAMES[player]}`}>
                {ELEMENTS.map((element) => (
                  <li className="arena__key" key={element}>
                    <Keycap label={keyLabels[player][element] ?? ''} variant="arena" />
                    <span className={`arena__element element-${element}`}>{ELEMENT_NAMES[element]}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      }
    />
  );
}
