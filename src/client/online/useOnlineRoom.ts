import { useCallback, useEffect, useRef, useState } from 'react';
import { TARGET_MAX, TARGET_MIN, type Element, type MatchSettings, type PlayerIndex } from '../../domain/index.ts';
import type { ErrorCode, PublicState, RoomEntry } from '../../shared/protocol/index.ts';
import type { ToastOptions } from '../components/toastContext.ts';
import { PLAYER_NAMES } from '../input/keys.ts';
import { createRoom, joinRoom } from './api.ts';
import { RoomConnection, type ConnectionEvent, type EndReason, type LinkStatus, type SocketFactory } from './connection.ts';
import { currentPick, opponentOf, suddenMarkOf, type OwnPick, type SuddenMark } from './game.ts';
import { codeFromInput, formatCode } from './invite.ts';
import {
  CODE_INPUT_MESSAGES,
  CREATE_FAILURES,
  JOIN_FAILURES,
  LATE_CHOICE,
  LINK_RESTORED,
  MATCH_CANCELLED,
  PAUSED_CHOICE,
  commandError,
  endMessage,
  isLastingEnd,
} from './messages.ts';
import { clearSession, saveSession } from './session.ts';

/**
 * Étapes du mode en ligne (maquette `online`) :
 * - `menu` : créer ou rejoindre (`busy` pendant la création) ;
 * - `join` : saisie du code reçu, message d'erreur éventuel ;
 * - `joining` : réservation de la place de Joueur 2 en cours ;
 * - `room` : place réservée ; `state` est `null` jusqu'au premier état du serveur ; `resuming` : place
 *   reprise après un rechargement de l'onglet (PFC-017), en attente de ce premier état.
 * Le token de reprise n'est jamais dans l'état React : la connexion le détient, et l'onglet le garde
 * en `sessionStorage` (`session.ts`) le temps de la room, pour reprendre sa place après un rechargement.
 */
export type OnlineFlow =
  | { readonly step: 'menu'; readonly busy: boolean }
  | { readonly step: 'join'; readonly draft: string; readonly error: string | null }
  | { readonly step: 'joining'; readonly code: string }
  | {
      readonly step: 'room';
      readonly roomCode: string;
      readonly slot: PlayerIndex;
      readonly state: PublicState | null;
      readonly resuming: boolean;
    };

/** Instantané rendu par l'écran ; la vérité courante vit dans une ref, mise à jour de façon synchrone. */
interface Snapshot {
  readonly flow: OnlineFlow;
  /** Réglages voulus par l'hôte, pas encore publiés par le serveur. */
  readonly desired: MatchSettings | null;
  /** `requestId` de l'`update-settings` en cours (un seul à la fois). */
  readonly settingsRequest: string | null;
  /** `requestId` du `ready` envoyé, jusqu'à sa publication, son ack ou son refus. */
  readonly readyRequest: string | null;
  /** `requestId` du `rematch-ready` envoyé, jusqu'à sa publication, son ack ou son refus. */
  readonly rematchRequest: string | null;
  /** Choix envoyé pour une manche : affiché à soi seul, jusqu'à la révélation publiée par le serveur. */
  readonly pick: OwnPick | null;
  /** `requestId` du `submit-choice` en attente de réponse. */
  readonly pickRequest: string | null;
  /** Manche qui a ouvert la mort subite de la partie en cours. */
  readonly sudden: SuddenMark | null;
  /** Décalage d'horloge serveur − local (`ServerClock`). */
  readonly offset: number;
  /** Derniers allers-retours mesurés (ms), du plus ancien au plus récent. */
  readonly rtts: readonly number[];
  /** Nombre de changements de réglages reçus du serveur : relance le signal visuel. */
  readonly settingsChanges: number;
  /** Préférence « Match nul » déjà appliquée à la room de l'hôte. */
  readonly drawApplied: boolean;
  /**
   * Les deux places ont été connectées ensemble au moins une fois : une place libérée par une
   * déconnexion reste réservée (reprise : PFC-017), le lobby ne redevient pas une attente d'adversaire.
   */
  readonly met: boolean;
  /** Lien avec le serveur : en ligne, ou coupure en cours de reprise (PFC-017). */
  readonly link: LinkStatus;
}

export interface OnlineRoom {
  readonly flow: OnlineFlow;
  /** Réglages affichés : ceux du serveur, ou pour l'hôte la valeur demandée pas encore confirmée. */
  readonly settings: MatchSettings | null;
  /** Réglages de l'hôte en cours d'envoi : la confirmation attend leur publication. */
  readonly syncing: boolean;
  /** Confirmation « Prêt » envoyée, pas encore publiée par le serveur. */
  readonly readyPending: boolean;
  /** Confirmation de revanche envoyée, pas encore publiée par le serveur. */
  readonly rematchPending: boolean;
  readonly pick: OwnPick | null;
  readonly sudden: SuddenMark | null;
  readonly offset: number;
  /** Latence médiane des dernières mesures (ms), `null` avant la première. */
  readonly latency: number | null;
  readonly settingsChanges: number;
  /** Les deux joueurs se sont déjà retrouvés dans cette room. */
  readonly met: boolean;
  /** Lien avec le serveur : `reconnecting` pendant une coupure, jusqu'à la reprise ou la fin. */
  readonly link: LinkStatus;
  readonly create: () => void;
  readonly openJoin: () => void;
  readonly editJoin: (draft: string) => void;
  readonly submitJoin: () => void;
  readonly back: () => void;
  readonly changeTarget: (delta: 1 | -1) => void;
  readonly setDraw: (drawEnabled: boolean) => void;
  readonly ready: () => void;
  /** Choix de sa propre place pendant la sélection (touches de Joueur 1 ou boutons, D11). */
  readonly choose: (element: Element) => void;
  /** Confirme la revanche (D12) : la partie suivante attend la confirmation de l'adversaire. */
  readonly rematch: () => void;
  /** Quitte la room depuis la partie ou sa fin : fermée pour les deux joueurs, retour à l'accueil. */
  readonly quit: () => void;
  /** « Réessayer » : tentative de reprise immédiate, ou resynchronisation du lien (PFC-017). */
  readonly retry: () => void;
}

export interface OnlineRoomOptions {
  /** Code d'une invitation ouverte (`/p/CODE`) : saisie préremplie. */
  readonly invitedCode: string | null;
  /** Place gardée par l'onglet avant un rechargement (PFC-017) : reprise dès l'ouverture. */
  readonly resume?: RoomEntry | null;
  /** Préférence « Match nul » de l'hôte, appliquée à sa room comme en local (D39). */
  readonly preferredDraw: boolean;
  readonly notify: (message: string, options?: ToastOptions) => void;
  /** Quitter le mode en ligne vers l'accueil. */
  readonly onExit: () => void;
  readonly socketFactory?: SocketFactory;
}

/** Mesures de latence gardées pour la médiane affichée. */
const LATENCY_SAMPLES = 5;

const sameSettings = (a: MatchSettings, b: MatchSettings) => a.target === b.target && a.drawEnabled === b.drawEnabled;

/** Vrai si les deux places sont au lobby et connectées : la confirmation est possible. */
export function canConfirm(state: PublicState | null): state is PublicState {
  return state?.phase === 'lobby' && state.connected[0] && state.connected[1];
}

/** Partie commencée et non terminée : la quitter l'annule, sans trophée (R09). */
export function isMatchInProgress(state: PublicState | null): boolean {
  return state !== null && (state.phase === 'starting' || state.phase === 'selecting' || state.phase === 'round-result' || state.phase === 'paused');
}

/** Réglages affichés : la valeur voulue par l'hôte tant qu'elle n'est pas publiée, sinon celle du serveur. */
function shownSettings({ flow, desired }: Snapshot): MatchSettings | null {
  if (flow.step !== 'room' || flow.state === null) return null;
  return flow.slot === 0 && desired !== null ? desired : flow.state.settings;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

const IDLE = {
  desired: null,
  settingsRequest: null,
  readyRequest: null,
  rematchRequest: null,
  pick: null,
  pickRequest: null,
  sudden: null,
  offset: 0,
  rtts: [],
  drawApplied: false,
  met: false,
  link: 'online',
} as const satisfies Partial<Snapshot>;

/** Refus d'un choix : arrivé après l'échéance (manche close), ou autre refus du serveur. */
function choiceError(code: ErrorCode): string | null {
  if (code === 'CHOICE_LOCKED') return null;
  return code === 'STALE_ROUND' || code === 'INVALID_PHASE' ? LATE_CHOICE : commandError(code);
}

/**
 * Parcours créer/rejoindre, lobby synchronisé (PFC-015) et partie en ligne (PFC-016). Le serveur
 * reste l'autorité : phases, réglages, confirmations, scores, résultats et trophées viennent de ses
 * états ; le client n'affiche d'avance que ce qui lui appartient (valeur demandée par l'hôte, son
 * propre choix), jamais un score. Commandes envoyées une à la fois par nature (réglages, prêt,
 * choix, revanche) : un double appui n'envoie rien de plus.
 */
export function useOnlineRoom(options: OnlineRoomOptions): OnlineRoom {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    ...IDLE,
    settingsChanges: 0,
    flow: initialFlow(options),
  }));
  const store = useRef(snapshot);
  // Garde synchrone : deux clics dans la même image ne lancent qu'une requête (aucune room orpheline).
  const entering = useRef<AbortController | null>(null);
  const connection = useRef<RoomConnection | null>(null);
  const latest = useRef(options);

  useEffect(() => {
    latest.current = options;
  });

  const update = useCallback((patch: Partial<Snapshot>) => {
    store.current = { ...store.current, ...patch };
    setSnapshot(store.current);
  }, []);

  /** Envoie la valeur voulue par l'hôte si aucune commande de réglages n'est en cours. */
  const pumpSettings = useCallback(() => {
    const { flow, desired, settingsRequest } = store.current;
    if (flow.step !== 'room' || flow.slot !== 0 || flow.state === null || desired === null || settingsRequest !== null) return;
    const { state } = flow;
    if (sameSettings(desired, state.settings) || (state.phase !== 'lobby' && state.phase !== 'match-ended')) {
      update({ desired: null });
      return;
    }
    const requestId =
      connection.current?.send({
        type: 'update-settings',
        payload: { expectedSettingsRevision: state.settingsRevision, settings: desired },
      }) ?? null;
    update(requestId === null ? { desired: null } : { settingsRequest: requestId });
  }, [update]);

  const onEvent = useCallback(
    (event: ConnectionEvent) => {
      const { flow, readyRequest, rematchRequest, settingsRequest, pickRequest, drawApplied, settingsChanges } = store.current;
      if (flow.step !== 'room') return;
      switch (event.type) {
        case 'state': {
          const before = flow.state;
          const next = event.state;
          announceChanges(before, next, flow.slot, latest.current.notify);
          const changed = before !== null && next.settingsRevision !== before.settingsRevision;
          update({
            flow: { ...flow, state: next, resuming: false },
            offset: event.offset,
            settingsChanges: changed ? settingsChanges + 1 : settingsChanges,
            readyRequest: next.ready[flow.slot] ? null : readyRequest,
            // Confirmation publiée, ou partie suivante lancée : plus rien en attente.
            rematchRequest: next.ready[flow.slot] || next.phase !== 'match-ended' ? null : rematchRequest,
            // `pickRequest` attend sa propre réponse : un choix tardif est refusé après l'état de révélation.
            sudden: suddenMarkOf(next) ?? store.current.sudden,
            met: store.current.met || (next.connected[0] && next.connected[1]),
          });
          // Préférence « Match nul » de l'hôte appliquée une seule fois à sa room.
          if (flow.slot === 0 && !drawApplied) {
            const drawEnabled = latest.current.preferredDraw;
            update({
              drawApplied: true,
              desired: next.settings.drawEnabled === drawEnabled ? null : { ...next.settings, drawEnabled },
            });
          }
          pumpSettings();
          return;
        }
        case 'latency':
          update({ offset: event.offset, rtts: [...store.current.rtts, event.rtt].slice(-LATENCY_SAMPLES) });
          return;
        case 'ack':
          if (event.requestId === settingsRequest) update({ settingsRequest: null });
          if (event.requestId === readyRequest) update({ readyRequest: null });
          if (event.requestId === rematchRequest) update({ rematchRequest: null });
          if (event.requestId === pickRequest) update({ pickRequest: null });
          pumpSettings();
          return;
        case 'error': {
          const { requestId, code } = event;
          if (requestId !== null && requestId === pickRequest) {
            // Refus du choix : le serveur n'a rien verrouillé (verrou déjà posé excepté), le choix affiché est retiré.
            const message = code === 'INVALID_PHASE' && flow.state?.phase === 'paused' ? PAUSED_CHOICE : choiceError(code);
            update(message === null ? { pickRequest: null } : { pickRequest: null, pick: null });
            if (message !== null) latest.current.notify(message);
            return;
          }
          if (requestId !== null && requestId === settingsRequest) {
            // Course de révision : renvoyée sur l'état suivant ; autre refus : retour à la vérité du serveur.
            update(code === 'STALE_SETTINGS' ? { settingsRequest: null } : { settingsRequest: null, desired: null });
          }
          if (requestId !== null && requestId === readyRequest) update({ readyRequest: null });
          if (requestId !== null && requestId === rematchRequest) update({ rematchRequest: null });
          latest.current.notify(commandError(code));
          pumpSettings();
          return;
        }
        case 'link': {
          if (event.status === 'reconnecting') {
            update({ link: 'reconnecting' });
            return;
          }
          // Reprise : les réponses des commandes envoyées avant la coupure sont perdues ; rien ne reste en
          // attente, et les réglages voulus par l'hôte sont renvoyés sur l'état frais. Son choix n'est
          // gardé que si le serveur publie son verrou pour la même manche (PFC-017).
          const { pick } = store.current;
          const state = flow.state;
          const kept = pick !== null && state !== null && currentPick(pick, state) !== null && state.choiceLocked[flow.slot];
          update({ link: 'online', settingsRequest: null, readyRequest: null, rematchRequest: null, pickRequest: null, pick: kept ? pick : null });
          latest.current.notify(LINK_RESTORED);
          pumpSettings();
          return;
        }
        case 'ended':
          notifyEnd(latest.current.notify, event.reason, PLAYER_NAMES[opponentOf(flow.slot)]);
          connection.current = null;
          clearSession();
          update({ ...IDLE, flow: { step: 'menu', busy: false } });
          return;
      }
    },
    [update, pumpSettings],
  );

  const connect = useCallback(
    (entry: RoomEntry, resuming = false) => {
      update({ ...IDLE, flow: { step: 'room', roomCode: entry.roomCode, slot: entry.slot, state: null, resuming } });
      saveSession(entry);
      connection.current = new RoomConnection(entry, onEvent, latest.current.socketFactory);
    },
    [update, onEvent],
  );

  const create = useCallback(() => {
    if (entering.current !== null || connection.current !== null) return;
    const controller = new AbortController();
    entering.current = controller;
    update({ flow: { step: 'menu', busy: true } });
    void createRoom(controller.signal).then((result) => {
      if (entering.current !== controller) return;
      entering.current = null;
      if (result.ok) {
        connect(result.entry);
        return;
      }
      if (result.failure === 'aborted') return;
      latest.current.notify(CREATE_FAILURES[result.failure]);
      update({ flow: { step: 'menu', busy: false } });
    });
  }, [update, connect]);

  const openJoin = useCallback(() => {
    if (entering.current !== null) return;
    update({ flow: { step: 'join', draft: '', error: null } });
  }, [update]);

  const editJoin = useCallback(
    (draft: string) => {
      if (store.current.flow.step === 'join') update({ flow: { step: 'join', draft, error: null } });
    },
    [update],
  );

  const submitJoin = useCallback(() => {
    const { flow } = store.current;
    if (flow.step !== 'join' || entering.current !== null || connection.current !== null) return;
    const input = codeFromInput(flow.draft);
    if (!input.ok) {
      update({ flow: { ...flow, error: CODE_INPUT_MESSAGES[input.error] } });
      return;
    }
    const controller = new AbortController();
    entering.current = controller;
    update({ flow: { step: 'joining', code: input.code } });
    void joinRoom(input.code, controller.signal).then((result) => {
      if (entering.current !== controller) return;
      entering.current = null;
      if (result.ok) {
        connect(result.entry);
        return;
      }
      if (result.failure === 'aborted') return;
      update({ flow: { step: 'join', draft: flow.draft, error: JOIN_FAILURES[result.failure] } });
    });
  }, [update, connect]);

  /** Quitte la room (PROTOCOL `leave` : fermée pour les deux joueurs) ; départ volontaire, silencieux. */
  const leaveRoom = useCallback(() => {
    connection.current?.leave();
    connection.current = null;
    clearSession();
    update({ ...IDLE, flow: { step: 'menu', busy: false } });
  }, [update]);

  const back = useCallback(() => {
    const { flow } = store.current;
    entering.current?.abort();
    entering.current = null;
    switch (flow.step) {
      case 'menu':
        latest.current.onExit();
        return;
      case 'joining':
        update({ flow: { step: 'join', draft: formatCode(flow.code), error: null } });
        return;
      case 'room':
        leaveRoom();
        return;
      case 'join':
        update({ flow: { step: 'menu', busy: false } });
        return;
    }
  }, [update, leaveRoom]);

  const quit = useCallback(() => {
    const { flow } = store.current;
    if (flow.step !== 'room') return;
    // Comme en local : quitter une partie en cours l'annule sans trophée ; après la fin, simple départ.
    if (isMatchInProgress(flow.state)) latest.current.notify(MATCH_CANCELLED);
    leaveRoom();
    latest.current.onExit();
  }, [leaveRoom]);

  // Place gardée avant un rechargement : reprise dès l'ouverture (PFC-017). Démontage sans « Quitter » :
  // requête abandonnée, socket fermée sans quitter la room, comme une coupure (D15 : l'adversaire voit la
  // pause, la room se ferme sans trophée 30 s plus tard) ; la place n'est plus gardée par l'onglet. Le
  // montage double de StrictMode rouvre ainsi une connexion au lieu de fermer la room.
  useEffect(() => {
    const resume = latest.current.resume ?? null;
    if (resume !== null && connection.current === null && entering.current === null) connect(resume, true);
    return () => {
      entering.current?.abort();
      entering.current = null;
      const current = connection.current;
      connection.current = null;
      if (current !== null) {
        current.dispose();
        clearSession();
      }
    };
  }, [connect]);

  const changeTarget = useCallback(
    (delta: 1 | -1) => {
      const { flow } = store.current;
      const current = shownSettings(store.current);
      if (flow.step !== 'room' || flow.slot !== 0 || current === null) return;
      const target = Math.min(TARGET_MAX, Math.max(TARGET_MIN, current.target + delta));
      if (target === current.target) return;
      update({ desired: { ...current, target } });
      pumpSettings();
    },
    [update, pumpSettings],
  );

  const setDraw = useCallback(
    (drawEnabled: boolean) => {
      const { flow } = store.current;
      const current = shownSettings(store.current);
      if (flow.step !== 'room' || flow.slot !== 0 || current === null) return;
      update({ desired: { ...current, drawEnabled } });
      pumpSettings();
    },
    [update, pumpSettings],
  );

  const ready = useCallback(() => {
    const { flow, readyRequest, desired, settingsRequest } = store.current;
    if (flow.step !== 'room' || !canConfirm(flow.state)) return;
    const { state } = flow;
    // Une confirmation vise les réglages publiés : jamais pendant l'envoi d'un changement de l'hôte.
    if (state.ready[flow.slot] || readyRequest !== null || desired !== null || settingsRequest !== null) return;
    const requestId =
      connection.current?.send({ type: 'ready', payload: { expectedSettingsRevision: state.settingsRevision } }) ?? null;
    update({ readyRequest: requestId });
  }, [update]);

  const choose = useCallback(
    (element: Element) => {
      const { flow, pick } = store.current;
      if (flow.step !== 'room' || flow.state?.phase !== 'selecting') return;
      const { state, slot } = flow;
      const { matchId, roundId } = state;
      // Premier choix verrouillé (D08) : aucun second envoi pour la même manche.
      if (matchId === null || roundId === null || currentPick(pick, state) !== null || state.choiceLocked[slot]) return;
      const requestId = connection.current?.send({ type: 'submit-choice', matchId, roundId, payload: { element } }) ?? null;
      if (requestId === null) return;
      update({ pick: { matchId, roundId, element }, pickRequest: requestId });
    },
    [update],
  );

  const rematch = useCallback(() => {
    const { flow, rematchRequest, desired, settingsRequest } = store.current;
    if (flow.step !== 'room' || flow.state?.phase !== 'match-ended') return;
    const { state, slot } = flow;
    // Comme au lobby : la confirmation vise les réglages publiés, jamais un changement en cours d'envoi.
    if (state.matchId === null || state.ready[slot] || rematchRequest !== null || desired !== null || settingsRequest !== null) return;
    const requestId =
      connection.current?.send({
        type: 'rematch-ready',
        matchId: state.matchId,
        payload: { expectedSettingsRevision: state.settingsRevision },
      }) ?? null;
    update({ rematchRequest: requestId });
  }, [update]);

  const retry = useCallback(() => {
    connection.current?.retryNow();
  }, []);

  const { flow, desired, settingsRequest, readyRequest, rematchRequest, settingsChanges, met, pick, sudden, offset, rtts, link } = snapshot;
  const settings = shownSettings(snapshot);

  return {
    flow,
    settings,
    syncing: desired !== null || settingsRequest !== null,
    readyPending: readyRequest !== null,
    rematchPending: rematchRequest !== null,
    pick,
    sudden,
    offset,
    latency: median(rtts),
    settingsChanges,
    met,
    link,
    create,
    openJoin,
    editJoin,
    submitJoin,
    back,
    changeTarget,
    setDraw,
    ready,
    choose,
    rematch,
    quit,
    retry,
  };
}

function initialFlow(options: OnlineRoomOptions): OnlineFlow {
  const { resume, invitedCode } = options;
  if (resume) return { step: 'room', roomCode: resume.roomCode, slot: resume.slot, state: null, resuming: true };
  return invitedCode === null ? { step: 'menu', busy: false } : { step: 'join', draft: formatCode(invitedCode), error: null };
}

/**
 * Fin de session annoncée : persistante quand le joueur était probablement absent (expiration de la
 * room, fermeture pendant une coupure), sinon brève.
 */
function notifyEnd(notify: OnlineRoomOptions['notify'], reason: EndReason, opponent: string): void {
  const message = endMessage(reason, opponent);
  if (isLastingEnd(reason)) notify(message, { persistent: true });
  else notify(message);
}

/**
 * Retours d'événements : arrivée ou départ de l'adversaire, réglages changés par l'hôte (lobby et
 * fin de partie). La revanche demandée par l'adversaire s'affiche sur l'écran de fin (région polie).
 */
function announceChanges(before: PublicState | null, after: PublicState, slot: PlayerIndex, notify: (message: string) => void): void {
  if (before === null) return;
  const other = opponentOf(slot);
  const opponent = PLAYER_NAMES[other];
  if (!before.connected[other] && after.connected[other]) {
    notify(after.phase === 'lobby' ? `${opponent} a rejoint la partie.` : `${opponent} est de retour.`);
  }
  // En partie, l'absence met la manche en pause : l'écran « Connexion interrompue » l'annonce déjà.
  if (before.connected[other] && !after.connected[other] && after.phase !== 'paused') notify(`${opponent} s’est déconnecté.`);
  const confirming = after.phase === 'lobby' || after.phase === 'match-ended';
  // Un changement de réglages est signalé à l'écran (valeurs, éclat doré) ; le toast ne sert qu'à la
  // confirmation perdue, pour ne pas empiler une notification par clic de l'hôte.
  if (confirming && slot === 1 && after.settingsRevision !== before.settingsRevision && before.ready[1]) {
    notify('Joueur 1 a modifié les réglages : confirmez à nouveau.');
  }
}
