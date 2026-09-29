import type { Page, WebSocketRoute } from '@playwright/test';
import { EMPTY_SELECTION, playRound, startMatch, type Choices, type MatchSettings } from '../../src/domain/index.ts';
import { roundResultMs } from '../../src/shared/cycle.ts';
import {
  SOCKET_CLOSE_CODES,
  encodeServerMessage,
  parseClientMessage,
  pongMessage,
  projectState,
  roomClosedMessage,
  type CloseReason,
  type RoomView,
} from '../../src/shared/protocol/index.ts';

/**
 * Room jouée par le test, pour la seule parité visuelle de l'arène en ligne (PFC-016) : horloge figée,
 * états choisis, comme la maquette dont l'adversaire est simulé. Les trames sont produites par la vraie
 * projection du serveur (`projectState`). Le multijoueur réel est prouvé ailleurs (online.spec.ts, Worker réel).
 */

const CODE = 'K7M2Q9XA';
/** Token conforme (256 bits base64url), jamais utilisé ailleurs que dans cette room simulée. */
const TOKEN = 'Zml4dHVyZS10b2tlbi1ub3QtYS1zZWNyZXQtMDAwMzI';
/**
 * Horloge du serveur simulé : décalée d'une constante de celle de la page (figée par le test), comme un
 * vrai serveur dont l'horloge avance au même rythme ; les échéances sont relatives à l'instant d'envoi.
 */
const SERVER_OFFSET = 1_000_000;

export interface FakeRoom {
  /** Résolue quand la page s'est authentifiée sur la socket. */
  readonly authenticated: Promise<void>;
  /** Publie un état de room (révision suivante) à la place de J1, construit à l'instant du serveur. */
  readonly publish: (state: (serverNow: number) => Partial<RoomView>) => Promise<void>;
  /**
   * Coupe la socket de la page comme un réseau perdu (PFC-017) : la page tente aussitôt une reprise,
   * authentifiée sur une nouvelle socket que la room simulée laisse sans réponse (« Reconnexion… »).
   */
  readonly drop: () => Promise<void>;
  /** Ferme la room comme le serveur (PFC-018) : `room-closed {reason}`, puis fermeture 4404. */
  readonly close: (reason: CloseReason) => Promise<void>;
}

function view(revision: number, overrides: Partial<RoomView>): RoomView {
  return {
    revision,
    roomCode: CODE,
    phase: 'lobby',
    resumePhase: null,
    settings: { target: 3, drawEnabled: true },
    settingsRevision: 0,
    match: null,
    roundId: null,
    selection: EMPTY_SELECTION,
    lastRound: null,
    trophies: [0, 0],
    ready: [false, false],
    connected: [true, true],
    deadline: null,
    ...overrides,
  };
}

const rooms = new WeakMap<Page, FakeRoom>();

/** Room simulée d'une page, installée par `fakeRoom` avant sa navigation. */
export function roomOf(page: Page): FakeRoom {
  const room = rooms.get(page);
  if (!room) throw new Error('Room simulée absente : appeler fakeRoom(page) avant la navigation.');
  return room;
}

/**
 * Création de room et socket de la room simulées pour la page (hôte, place J1). À installer avant la
 * navigation : `routeWebSocket` n'intercepte que les pages chargées après son appel (mesuré).
 */
export async function fakeRoom(page: Page): Promise<FakeRoom> {
  let socket: WebSocketRoute | null = null;
  let revision = 10;
  let authenticated: () => void = () => undefined;
  const serverNow = async () => SERVER_OFFSET + (await page.evaluate(() => performance.now()));
  const ready = new Promise<void>((resolve) => {
    authenticated = resolve;
  });
  await page.route('**/api/rooms', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ roomCode: CODE, slot: 0, resumeToken: TOKEN }) }),
  );
  await page.routeWebSocket('**/api/rooms/*/ws', (ws) => {
    ws.onMessage((message) => {
      const parsed = parseClientMessage(typeof message === 'string' ? message : message.toString('utf8'));
      if (!parsed.ok) return;
      if (parsed.command.type === 'authenticate') {
        socket = ws;
        authenticated();
        reauthenticated();
      } else if (parsed.command.type === 'ping') {
        const { requestId } = parsed.command;
        void serverNow().then((now) => {
          ws.send(encodeServerMessage(pongMessage(requestId, now)));
        });
      }
    });
  });
  let reauthenticated: () => void = () => undefined;
  const room: FakeRoom = {
    authenticated: ready,
    drop: async () => {
      const current = socket;
      const again = new Promise<void>((resolve) => {
        reauthenticated = resolve;
      });
      await current?.close({ code: 1001, reason: 'coupure simulée' });
      await again;
    },
    close: async (reason) => {
      socket?.send(encodeServerMessage(roomClosedMessage(reason)));
      await socket?.close({ code: SOCKET_CLOSE_CODES.ROOM_UNAVAILABLE });
    },
    publish: async (state) => {
      const now = await serverNow();
      revision += 1;
      socket?.send(encodeServerMessage(projectState(view(revision, state(now)), 0, now)));
    },
  };
  rooms.set(page, room);
  return room;
}

/** Ouverture d'une partie : `starting`, 2,2 s avant la sélection (D38). */
export const startingState =
  (settings: MatchSettings) =>
  (now: number): Partial<RoomView> => ({
    phase: 'starting',
    settings,
    match: startMatch('m-11', settings),
    roundId: 1,
    deadline: now + 2_200,
  });

export const selectingState =
  (settings: MatchSettings) =>
  (now: number): Partial<RoomView> => ({
    ...startingState(settings)(now),
    phase: 'selecting',
    deadline: now + 5_000,
  });

/** Manche révélée à l'instant du serveur (J1 d'abord), échéance de résultat publiée comme par le serveur. */
export const roundResultState = (settings: MatchSettings, choices: Choices) => (now: number): Partial<RoomView> => {
  const play = playRound(startMatch('m-11', settings), choices);
  const followUp = play.match.result.status === 'playing' ? 'next' : 'end';
  return {
    phase: 'round-result',
    settings,
    match: play.match,
    roundId: 1,
    selection: choices,
    lastRound: { roundId: 1, choices, resolution: play.round },
    deadline: now + roundResultMs(play.round.kind, followUp),
  };
};

/** Partie terminée après une manche, trophée réglé au vainqueur. */
export const matchEndedState = (settings: MatchSettings, choices: Choices) => (): Partial<RoomView> => {
  const play = playRound(startMatch('m-11', settings), choices);
  const { result } = play.match;
  return {
    phase: 'match-ended',
    settings,
    match: play.match,
    roundId: 1,
    lastRound: { roundId: 1, choices, resolution: play.round },
    trophies: result.status === 'won' ? (result.winner === 0 ? [1, 0] : [0, 1]) : [1, 1],
  };
};

/**
 * Sélection mise en pause par l'absence de J2 (PFC-017) : phase à reprendre, échéance de reconnexion à
 * 30 s publiée comme `deadline`.
 */
export const pausedState =
  (settings: MatchSettings) =>
  (now: number): Partial<RoomView> => ({
    ...startingState(settings)(now),
    phase: 'paused',
    resumePhase: 'selecting',
    connected: [true, false],
    deadline: now + 30_000,
  });
