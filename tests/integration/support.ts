import { createTestHarness, type TestHarness } from 'wrangler';
import type { RoomView } from '../../src/shared/protocol/index.ts';
import type { PersistedRoom } from '../../src/worker/codec.ts';
import type { RoomStorageErrorCode } from '../../src/worker/errors.ts';
import { SECRETS, type StoredRoom } from '../unit/protocol/rooms.ts';

/**
 * Runtime Workers local réel (workerd, via l'API de test de wrangler) sur le Worker de test
 * `harness/wrangler.jsonc` : Worker de production + accès à l'état durable des rooms.
 */
export async function startHarness(): Promise<TestHarness> {
  const server = createTestHarness({
    root: import.meta.dirname,
    workers: [{ configPath: 'harness/wrangler.jsonc' }],
  });
  await server.listen();
  return server;
}

/** État v1 (PFC-011) d'une room de test : les fixtures du protocole sans les secrets simulés. */
export function persistedV1(room: StoredRoom): RoomView {
  const secretKeys = new Set(Object.keys(SECRETS));
  return Object.fromEntries(Object.entries(room).filter(([key]) => !secretKeys.has(key))) as unknown as RoomView;
}

/**
 * État courant (v5) d'une room de test : la vue v1 plus deux places dont les hashes sont ceux des
 * fixtures, déjà connectées (aucune réservation en attente) selon `connected` (v2, PFC-012), la partie
 * réglée si elle est terminée et aucune réponse mémorisée (v3, PFC-014). v4 (PFC-017) : une place
 * absente porte une échéance de reconnexion ; une pause publie cette échéance (`deadline`) et garde
 * 2 s de sa phase interrompue. v5 (PFC-018) : créée à `createdAt`, dernière activité au même instant ;
 * une room relue par une vraie room doit être datée près de son horloge (4 h de durée maximale).
 */
export function persisted(room: StoredRoom, createdAt = 1_700_000_000_000): PersistedRoom {
  const [host, guest] = SECRETS.tokenHashes;
  const paused = room.phase === 'paused';
  const absent = !room.connected[0] || !room.connected[1];
  return {
    ...persistedV1(room),
    createdAt,
    seats: [
      { tokenHash: host ?? '', reservedUntil: null },
      { tokenHash: guest ?? '', reservedUntil: null },
    ],
    settledMatchId: room.phase === 'match-ended' ? (room.match?.id ?? null) : null,
    replies: [[], []],
    reconnectDeadline: absent ? (paused ? room.deadline : createdAt + 30_000) : null,
    resumeRemainingMs: paused ? 2000 : null,
    lastActivityAt: createdAt,
  };
}

export type WriteResult =
  | { readonly ok: true; readonly state: PersistedRoom }
  | { readonly ok: false; readonly code: RoomStorageErrorCode };

export async function writeRoom(server: TestHarness, name: string, state: unknown): Promise<WriteResult> {
  const response = await server.fetch(`/__harness/rooms/${name}`, { method: 'PUT', body: JSON.stringify(state) });
  return (await response.json()) as WriteResult;
}

export async function readRoom(server: TestHarness, name: string): Promise<PersistedRoom | null> {
  const response = await server.fetch(`/__harness/rooms/${name}`);
  return ((await response.json()) as { state: PersistedRoom | null }).state;
}

/** Détruit l'instance en mémoire, stockage conservé : le prochain appel reconstruit l'objet. */
export async function rebuild(server: TestHarness, name: string): Promise<void> {
  await server.getWorker().evictDurableObject('ROOMS', { name });
}

export interface RoomRow {
  readonly schema_version: unknown;
  readonly revision: unknown;
  readonly state: unknown;
}

/** Lignes brutes de `room_state`, lues dans l'objet lui-même ; aucune si la table n'existe pas. */
export async function rows(server: TestHarness, name: string): Promise<RoomRow[]> {
  if (!(await tables(server, name)).includes('room_state')) return [];
  const sql = await server.getWorker().getDurableObjectStorage('ROOMS', { name });
  return (await sql.exec('SELECT schema_version, revision, state FROM room_state')) as unknown as RoomRow[];
}

/**
 * Tables SQLite de l'objet, hors tables internes (`_cf_*` de workerd, `__miniflare_do_name` que Miniflare
 * ajoute en local pour `getByName`) : `[]` pour un stockage jamais alloué par la room ou effacé.
 */
export async function tables(server: TestHarness, name: string): Promise<string[]> {
  const sql = await server.getWorker().getDurableObjectStorage('ROOMS', { name });
  const found = (await sql.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name <> '__miniflare_do_name' ORDER BY name",
  )) as unknown as { name: string }[];
  return found.map((table) => table.name);
}

/** Fige l'horloge des rooms du harnais (ms absolues) ; `null` rétablit l'heure réelle. */
export async function setClock(server: TestHarness, now: number | null): Promise<void> {
  await server.fetch('/__harness/clock', { method: 'PUT', body: JSON.stringify({ now }) });
}

/** Alarme planifiée de la room (ms absolues) ; avec `run`, exécute d'abord son traitement. */
export async function alarm(server: TestHarness, name: string, run = false): Promise<number | null> {
  const response = await server.fetch(`/__harness/rooms/${name}/alarm`, { method: run ? 'POST' : 'GET' });
  return ((await response.json()) as { alarm: number | null }).alarm;
}

/** Exécute le traitement d'alarme ; `failed` s'il a levé (le runtime le relancerait). */
export async function runAlarm(server: TestHarness, name: string): Promise<{ alarm: number | null; failed: boolean }> {
  const response = await server.fetch(`/__harness/rooms/${name}/alarm`, { method: 'POST' });
  return (await response.json()) as { alarm: number | null; failed: boolean };
}

/** Fait échouer les `commits` prochaines écritures de la room (panne de stockage simulée). */
export async function failCommits(server: TestHarness, name: string, commits: number): Promise<void> {
  await server.fetch(`/__harness/rooms/${name}/fail`, { method: 'PUT', body: JSON.stringify({ commits }) });
}

export async function execSql(server: TestHarness, name: string, query: string, ...bindings: unknown[]): Promise<void> {
  const sql = await server.getWorker().getDurableObjectStorage('ROOMS', { name });
  await sql.exec(query, ...bindings);
}

/** Délai maximal d'attente d'une trame ou d'une fermeture : un test bloqué échoue lisiblement. */
const SOCKET_WAIT_MS = 10_000;

/** Le WebSocket de Node (undici) accepte des en-têtes d'upgrade explicites, absents du type DOM. */
const NodeWebSocket = WebSocket as unknown as new (url: URL, init: { headers?: Record<string, string> }) => WebSocket;

/**
 * Socket réelle, ouverte depuis Node sur le serveur du harnais (pile réseau et upgrade de workerd,
 * sans simulation) ; elle enregistre chaque trame reçue et sa fermeture.
 */
export interface SocketProbe {
  /** Trames texte reçues, dans l'ordre. */
  readonly raw: readonly string[];
  /** Vrai si l'upgrade a abouti (101). */
  readonly opened: Promise<boolean>;
  readonly closed: Promise<{ readonly code: number }>;
  /** Trame suivante non encore lue, décodée ; échoue après 10 s. */
  next(): Promise<Record<string, unknown>>;
  send(frame: unknown): void;
  sendRaw(data: string | Uint8Array<ArrayBuffer>): void;
  close(): void;
}

/**
 * Ouvre `GET /api/rooms/:code/ws`. `origin` : en-tête `Origin` envoyé (celui du harnais par défaut,
 * comme un navigateur sur la page de l'application) ; `null` : aucun.
 */
export async function openSocket(server: TestHarness, roomCode: string, origin?: string | null): Promise<SocketProbe> {
  const { url } = await server.listen();
  const target = new URL(`/api/rooms/${roomCode}/ws`, url);
  target.protocol = 'ws:';
  const sentOrigin = origin === undefined ? url.origin : origin;
  const ws = new NodeWebSocket(target, sentOrigin === null ? {} : { headers: { origin: sentOrigin } });
  const raw: string[] = [];
  let read = 0;
  const waiters: (() => void)[] = [];
  const wake = (): void => {
    for (const waiter of waiters.splice(0)) waiter();
  };
  ws.addEventListener('message', (event) => {
    raw.push(typeof event.data === 'string' ? event.data : '<binaire>');
    wake();
  });
  const opened = new Promise<boolean>((resolve) => {
    ws.addEventListener('open', () => {
      resolve(true);
    });
    ws.addEventListener('close', () => {
      resolve(false);
    });
  });
  const closed = new Promise<{ code: number }>((resolve) => {
    ws.addEventListener('close', (event) => {
      resolve({ code: event.code });
      wake();
    });
  });
  const isClosed = (): boolean => ws.readyState === WebSocket.CLOSED;
  await opened;
  return {
    raw,
    opened,
    closed,
    async next() {
      const deadline = Date.now() + SOCKET_WAIT_MS;
      while (read >= raw.length) {
        if (isClosed()) throw new Error(`Socket fermée sans trame supplémentaire (reçues : ${raw.join(' | ')}).`);
        if (Date.now() > deadline) throw new Error('Aucune trame reçue dans le délai.');
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 200);
        });
      }
      const frame = raw[read] ?? '';
      read += 1;
      return JSON.parse(frame) as Record<string, unknown>;
    },
    send(frame) {
      ws.send(JSON.stringify(frame));
    },
    sendRaw(data) {
      ws.send(data);
    },
    close() {
      ws.close(1000);
    },
  };
}

/** Attend la fermeture, au plus 10 s. */
export async function closedWith(probe: SocketProbe): Promise<number> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('Socket toujours ouverte.'));
    }, SOCKET_WAIT_MS);
  });
  return (await Promise.race([probe.closed, timeout])).code;
}
