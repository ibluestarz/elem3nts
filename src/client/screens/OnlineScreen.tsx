import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, type PlayerIndex } from '../../domain/index.ts';
import type { PublicState, RoomEntry } from '../../shared/protocol/index.ts';
import { useToast } from '../components/toastContext.ts';
import type { KeyBindings, KeySlot } from '../input/keys.ts';
import { PLAYER_NAMES } from '../input/keys.ts';
import { isEditableTarget, ownsKey, useLocalKeys } from '../input/useLocalKeys.ts';
import {
  currentPick,
  fromMySide,
  isArenaPhase,
  onlineArenaModel,
  onlineNames,
  onlineSceneView,
  opponentOf,
  timelineOf,
  trophiesWonOf,
  verdictOf,
  type Segment,
} from '../online/game.ts';
import { formatCode } from '../online/invite.ts';
import { toLocalTime } from '../online/serverClock.ts';
import { useOnlineRoom, type OnlineFlow, type OnlineRoom } from '../online/useOnlineRoom.ts';
import { useTimelinePhase } from '../online/useTimelinePhase.ts';
import { useScene } from '../scene/sceneContext.ts';
import { useSceneBridge } from '../scene/useSceneBridge.ts';
import type { Quality } from '../state/preferences.ts';
import { EndScreen, type ReplayState } from './EndScreen.tsx';
import { ConnectionLost, type LostKind } from './online/ConnectionLost.tsx';
import { InviteCard } from './online/InviteCard.tsx';
import { JoinForm } from './online/JoinForm.tsx';
import { Lobby } from './online/Lobby.tsx';
import { OnlineArena } from './online/OnlineArena.tsx';
import { SettingsPanel } from './online/SettingsPanel.tsx';
import { TargetRow } from './online/TargetRow.tsx';
import './panel.css';
import './OnlineScreen.css';

interface OnlineScreenProps {
  readonly compact: boolean;
  /** Code d'une invitation ouverte (`/p/CODE`) : l'écran s'ouvre sur « Rejoindre », code prérempli. */
  readonly invitedCode: string | null;
  /** Place gardée par l'onglet avant un rechargement (PFC-017) : l'écran reprend la room aussitôt. */
  readonly resume?: RoomEntry | null;
  /** Préférence « Match nul » (Réglages), appliquée à la room créée (D39). */
  readonly preferredDraw: boolean;
  /** Libellés des touches de Joueur 1 : en ligne, elles choisissent pour sa propre place (D11). */
  readonly keyLabels: Readonly<Record<string, string>>;
  readonly bindings: KeyBindings;
  readonly sceneOptions: { readonly quality: Quality; readonly reducedMotion: boolean; readonly compact: boolean };
  /** Libellé réel observé pour un code physique (corrige l'affichage des touches). */
  readonly onLearn: (code: string, label: string) => void;
  readonly onExit: () => void;
}

type PanelView = 'menu' | 'join' | 'connecting' | 'host' | 'lobby';
type View = PanelView | 'arena' | 'end';

const TITLES: Readonly<Record<PanelView, string>> = {
  menu: 'Choisissez',
  join: 'Rejoindre',
  connecting: 'Connexion…',
  host: 'Votre partie',
  lobby: 'Préparer le duel',
};

const BACK_LABELS: Readonly<Record<PanelView, string>> = {
  menu: 'Retour',
  join: 'Annuler',
  connecting: 'Annuler',
  host: 'Annuler',
  lobby: 'Quitter',
};

const NO_TIMELINE: readonly Segment[] = [{ phase: 'intro', start: -Infinity }];

/**
 * Vue affichée pour une étape : maquette `online` (menu, hôte, saisie, connexion) + lobby (D39), puis
 * l'arène dès l'ouverture de la partie (`starting`, bannière D38) et l'écran de fin.
 */
function viewOf(flow: OnlineFlow, met: boolean): View {
  switch (flow.step) {
    case 'menu':
      return 'menu';
    case 'join':
      return 'join';
    case 'joining':
      return 'connecting';
    case 'room': {
      const { state, slot } = flow;
      // Reprise après rechargement : « Connexion… » jusqu'au premier état, quelle que soit la place.
      if (state === null) return slot === 0 && !flow.resuming ? 'host' : 'connecting';
      if (state.phase === 'match-ended' && state.matchResult) return 'end';
      if (state.phase !== 'lobby') return 'arena';
      return slot === 1 || met || (state.connected[0] && state.connected[1]) ? 'lobby' : 'host';
    }
  }
}

/** Points de suspension animés de la maquette (un point de plus toutes les 0,9 s, puis retour à zéro). */
function Dots() {
  return (
    <span className="dots" aria-hidden="true">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}

/** État du bouton « Rejouer » en ligne : confirmé (attente de l'adversaire), envoi en cours, ou libre. */
function replayOf(state: PublicState, room: OnlineRoom): ReplayState {
  const opponent = PLAYER_NAMES[opponentOf(state.yourSlot)];
  if (state.ready[state.yourSlot]) return { status: 'waiting', label: `En attente de ${opponent}…` };
  return room.rematchPending || room.syncing ? { status: 'pending' } : { status: 'idle' };
}

/** Information de revanche : absence ou confirmation de l'adversaire. */
function rematchNotice(state: PublicState): string | null {
  const other: PlayerIndex = opponentOf(state.yourSlot);
  const opponent = PLAYER_NAMES[other];
  if (!state.connected[other]) return `${opponent} est déconnecté : la revanche attend son retour.`;
  if (state.ready[other] && !state.ready[state.yourSlot]) return `${opponent} veut rejouer.`;
  return null;
}

/**
 * Mode en ligne (PFC-015, PFC-016) : créer ou rejoindre une room privée, lobby synchronisé, puis la
 * partie, ses révélations et la revanche, telles que le serveur les publie. Espace confirme (lobby,
 * revanche) ; Échap revient en arrière ou quitte ; les touches de Joueur 1 choisissent pour sa place.
 */
export function OnlineScreen(props: OnlineScreenProps) {
  const { compact, invitedCode, resume, preferredDraw, keyLabels, bindings, sceneOptions, onLearn, onExit } = props;
  const toast = useToast();
  const room = useOnlineRoom({ invitedCode, resume: resume ?? null, preferredDraw, notify: toast.show, onExit });
  const { flow } = room;
  const view = viewOf(flow, room.met);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const state = flow.step === 'room' ? flow.state : null;

  // Moment affiché : chronologie publiée par le serveur, sur l'horloge locale (aucun résultat inventé).
  const timeline = useMemo(() => (state === null ? NO_TIMELINE : timelineOf(state, room.offset)), [state, room.offset]);
  const timelinePhase = useTimelinePhase(timeline);
  // Son lien coupé : le serveur a mis la partie en pause (place absente, D15) ; l'arène l'affiche
  // aussitôt plutôt que de laisser courir une chronologie qu'il ne tient plus (PFC-017).
  const phase = room.link === 'reconnecting' && state !== null && isArenaPhase(state) ? 'pause' : timelinePhase;

  const scene = useScene();
  const sceneView = useMemo(() => onlineSceneView(state, phase, room.pick), [state, phase, room.pick]);
  useSceneBridge(scene.engine, sceneView, sceneOptions);

  // Chaque étape du panneau annonce son titre ; la saisie du code prend elle-même le focus.
  useEffect(() => {
    if (view !== 'join') titleRef.current?.focus();
  }, [view]);

  // Espace confirme (lobby, revanche), sauf sur un contrôle qui a sa propre action ; Échap revient en
  // arrière (panneau) ou quitte la room (partie, fin de partie).
  const keys = useRef({ view, ready: room.ready, rematch: room.rematch, back: room.back, quit: room.quit });
  useEffect(() => {
    keys.current = { view, ready: room.ready, rematch: room.rematch, back: room.back, quit: room.quit };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const current = keys.current;
      const isSpace = event.code === 'Space' || event.key === ' ';
      if (isSpace && !ownsKey(event.target)) {
        if (current.view === 'lobby') {
          event.preventDefault();
          current.ready();
        } else if (current.view === 'end') {
          event.preventDefault();
          current.rematch();
        }
        return;
      }
      if (event.key === 'Escape' && !isEditableTarget(event.target)) {
        event.preventDefault();
        if (current.view === 'arena' || current.view === 'end') current.quit();
        else current.back();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // Touches de Joueur 1 pour sa propre place, même en Joueur 2 (SPEC saisie) ; lues seulement en sélection.
  const accepting = useRef(false);
  useLayoutEffect(() => {
    accepting.current = view === 'arena' && phase === 'selecting';
  }, [view, phase]);
  const ownKeys = useMemo<KeyBindings>(() => [bindings[0], bindings[0]], [bindings]);
  const { choose } = room;
  const onChoose = useCallback(
    (slot: KeySlot) => {
      choose(slot.element);
    },
    [choose],
  );
  useLocalKeys({ enabled: view === 'arena', accepting, bindings: ownKeys, onChoose, onLearn });

  // Coupure (PFC-017) : son propre lien en reprise, quel que soit l'écran de la room ; ou, dans l'arène,
  // la partie mise en pause par l'absence de l'adversaire, avec l'échéance de reconnexion publiée.
  const lostKind: LostKind | null =
    flow.step === 'room' && room.link === 'reconnecting'
      ? 'self'
      : view === 'arena' && state?.phase === 'paused'
        ? 'opponent'
        : null;
  const lost = (
    <ConnectionLost
      kind={lostKind}
      opponent={PLAYER_NAMES[opponentOf(flow.step === 'room' ? flow.slot : 0)]}
      deadline={state?.phase === 'paused' && state.deadline !== undefined ? toLocalTime(state.deadline, room.offset) : null}
      onRetry={room.retry}
      onQuit={room.quit}
    />
  );
  const withLost = (screen: ReactNode) => (
    <>
      {screen}
      {lost}
    </>
  );

  if (view === 'arena' && state !== null) {
    const model = onlineArenaModel({ state, phase, offset: room.offset, pick: room.pick, sudden: room.sudden });
    return withLost(
      <OnlineArena
        compact={compact}
        model={model}
        slot={state.yourSlot}
        opponentConnected={state.connected[opponentOf(state.yourSlot)]}
        pick={currentPick(room.pick, state)}
        latency={room.latency}
        keyLabels={keyLabels}
        matchId={state.matchId ?? undefined}
        onChoose={room.choose}
        onQuit={room.quit}
      />
    );
  }

  if (view === 'end' && state?.matchResult !== undefined && room.settings !== null) {
    const slot = state.yourSlot;
    return withLost(
      <EndScreen
        compact={compact}
        verdict={verdictOf(state.matchResult, slot)}
        names={onlineNames(slot)}
        scores={fromMySide(state.scores, slot)}
        trophies={fromMySide(state.trophies, slot)}
        won={trophiesWonOf(state.matchResult, slot)}
        replay={replayOf(state, room)}
        notice={rematchNotice(state)}
        matchId={state.matchId ?? undefined}
        onReplay={room.rematch}
        onHome={room.quit}
      >
        <SettingsPanel
          settings={room.settings}
          host={slot === 0}
          changes={room.settingsChanges}
          label="Réglages de la revanche"
          className="end__settings"
          onStep={room.changeTarget}
          onDraw={room.setDraw}
        />
      </EndScreen>
    );
  }

  const panel: PanelView = view === 'arena' || view === 'end' ? 'connecting' : view;
  const roomCode = flow.step === 'room' ? flow.roomCode : flow.step === 'joining' ? flow.code : null;

  return withLost(
    <div className="online screen-enter">
      <section className="online__panel" aria-labelledby="screen-title" aria-busy={panel === 'connecting'} data-online-step={panel}>
        <div className="online__header">
          <p className="panel-label">
            Jouer en ligne
            {panel === 'lobby' && roomCode !== null && <span className="online__room"> · Partie {formatCode(roomCode)}</span>}
          </p>
          <h2 key={panel} className="online__title" id="screen-title" tabIndex={-1} ref={titleRef} data-focus-target>
            {TITLES[panel]}
          </h2>
        </div>

        <div key={panel} className="online__step">
          {panel === 'menu' && flow.step === 'menu' && (
            <div className="online__choices">
              <button
                type="button"
                className="online__choice"
                aria-disabled={flow.busy}
                aria-busy={flow.busy}
                onClick={room.create}
              >
                <span className="online__choice-title">Créer une partie</span>
                <span className="online__choice-sub">
                  {flow.busy ? (
                    <>
                      Création de la partie
                      <Dots />
                    </>
                  ) : (
                    'Obtenez un code à partager avec votre adversaire'
                  )}
                </span>
              </button>
              <button type="button" className="online__choice" aria-disabled={flow.busy} onClick={room.openJoin}>
                <span className="online__choice-title">Rejoindre une partie</span>
                <span className="online__choice-sub">Saisissez le code reçu</span>
              </button>
            </div>
          )}

          {panel === 'join' && flow.step === 'join' && (
            <JoinForm draft={flow.draft} error={flow.error} onDraft={room.editJoin} onSubmit={room.submitJoin} />
          )}

          {panel === 'connecting' && (
            <div className="found">
              <p className="found__sub">
                Connexion à la partie {roomCode === null ? '' : formatCode(roomCode)}
                <Dots />
              </p>
              <p className="found__name" />
            </div>
          )}

          {panel === 'host' && roomCode !== null && (
            <>
              <InviteCard code={roomCode} />
              <TargetRow target={room.settings?.target ?? DEFAULT_SETTINGS.target} onStep={room.changeTarget} />
              <p className="waiting">
                <span className="waiting__gem" aria-hidden="true" />
                {state === null ? 'Connexion à la partie' : 'En attente d’un adversaire'}
                <Dots />
              </p>
            </>
          )}

          {panel === 'lobby' && flow.step === 'room' && state !== null && room.settings !== null && (
            <Lobby
              state={state}
              slot={flow.slot}
              settings={room.settings}
              compact={compact}
              syncing={room.syncing}
              readyPending={room.readyPending}
              settingsChanges={room.settingsChanges}
              onStep={room.changeTarget}
              onDraw={room.setDraw}
              onReady={room.ready}
            />
          )}
        </div>

        <button type="button" className="online__back" onClick={room.back}>
          {BACK_LABELS[panel]}
        </button>
      </section>
    </div>
  );
}
