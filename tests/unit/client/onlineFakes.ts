import { DEFAULT_SETTINGS, EMPTY_SELECTION, type PlayerIndex } from '../../../src/domain/index.ts';
import {
  encodeServerMessage,
  projectState,
  roomClosedMessage,
  ackMessage,
  errorMessage,
  type CloseReason,
  type ErrorCode,
  type RoomView,
} from '../../../src/shared/protocol/index.ts';

/** Token conforme (256 bits base64url) : aucune sortie observable ne doit le contenir. */
export const TOKEN = 'Zml4dHVyZS10b2tlbi1ub3QtYS1zZWNyZXQtMDAwMzI';
export const CODE = 'K7M2Q9XA';

/**
 * Socket factice pilotée par le test : le client la voit comme un `WebSocket` (écouteurs, `send`,
 * `close`, `readyState`), le test joue le serveur (`open`, `receive`, `serverClose`).
 */
export class FakeSocket {
  static readonly instances: FakeSocket[] = [];
  readonly url: string;
  readonly sent: Record<string, unknown>[] = [];
  readyState = 0;
  closedByClient = false;
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  static reset(): void {
    FakeSocket.instances.length = 0;
  }

  static last(): FakeSocket {
    const socket = FakeSocket.instances.at(-1);
    if (!socket) throw new Error('Aucune socket ouverte.');
    return socket;
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  removeEventListener(): void {
    // Non utilisé par le client.
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    this.closedByClient = true;
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.#emit('open', {});
  }

  receive(data: string): void {
    this.#emit('message', { data });
  }

  serverClose(code: number): void {
    this.readyState = 3;
    this.#emit('close', { code });
  }

  /** Dernière commande envoyée d'un type donné. */
  lastSent(type: string): Record<string, unknown> | undefined {
    return this.sent.filter((frame) => frame['type'] === type).at(-1);
  }

  #emit(type: string, event: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

/** Vue de room au lobby, complétée par `overrides` : base des trames d'état des tests. */
export function roomView(overrides: Partial<RoomView> = {}): RoomView {
  return {
    revision: 3,
    roomCode: CODE,
    phase: 'lobby',
    resumePhase: null,
    settings: DEFAULT_SETTINGS,
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

/** Trame `state` construite par la vraie projection (allowlist) depuis une vue de room. */
export function stateFrame(slot: PlayerIndex, overrides: Partial<RoomView> = {}, serverNow = 1_000): string {
  return encodeServerMessage(projectState(roomView(overrides), slot, serverNow));
}

export const ackFrame = (requestId: string, revision = 4) => encodeServerMessage(ackMessage(requestId, revision));
export const errorFrame = (code: ErrorCode, requestId?: string) => encodeServerMessage(errorMessage(code, requestId));
export const closedFrame = (reason: CloseReason) => encodeServerMessage(roomClosedMessage(reason));

/** Réponse HTTP JSON d'entrée dans une room. */
export function entryResponse(slot: PlayerIndex, status = slot === 0 ? 201 : 200): Response {
  return new Response(JSON.stringify({ roomCode: CODE, slot, resumeToken: TOKEN }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function errorResponse(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code, message: 'x' } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
