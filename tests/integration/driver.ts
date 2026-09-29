import { createHash } from 'node:crypto';
import type { TestHarness } from 'wrangler';
import { expect } from 'vitest';
import { parseRoomEntry, type RoomEntry } from '../../src/shared/protocol/index.ts';
import type { PersistedRoom } from '../../src/worker/codec.ts';
import { openSocket, readRoom, runAlarm, setClock, type SocketProbe } from './support.ts';

/**
 * Pilote de partie en ligne pour les tests d'intégration (PFC-019) : les mêmes gestes que
 * `game.test.ts` (PFC-014), liés à un harnais. Chaque action passe par l'API publique ou une vraie
 * socket ; le harnais ne sert qu'à figer l'horloge, exécuter les alarmes et relire l'état persisté.
 */

/** Instant figé des tests : dans le futur (2033), aucune alarme réelle ne se déclenche seule. */
export const T0 = 2_000_000_000_000;
/** Contrat D08/D09/D15/D16, écrit en clair : ouverture 2,2 s, sélection 5 s, reconnexion 30 s, inactivité 30 min. */
export const INTRO_MS = 2200;
export const SELECTION_MS = 5000;
export const RECONNECT_MS = 30_000;
export const IDLE_MS = 30 * 60_000;
/** Résultat final (révélation 1,1 s + effet + 1,6 s + fermeture 0,7 s) : burn 3,6 s, wave 3,4 s, solo 2,4 s, flare 3 s. */
export const RESULT_MS = {
  burnEnd: 1100 + 3600 + 1600 + 700,
  waveEnd: 1100 + 3400 + 1600 + 700,
  soloEnd: 1100 + 2400 + 1600 + 700,
  flareEnd: 1100 + 3000 + 1600 + 700,
} as const;

/** Un élément en clair dans une trame (valeurs du protocole). */
export const ELEMENT_PATTERN = /fire|water|plant/;

export type Frame = Record<string, unknown>;

export interface Duel {
  readonly code: string;
  /** Tokens de reprise de J1 et J2 (la room n'en garde que l'empreinte). */
  readonly tokens: readonly [string, string];
  host: SocketProbe;
  guest: SocketProbe;
}

/** Empreinte persistée d'un token (même calcul que `hashResumeToken`). */
export const sha256 = (token: string): string => createHash('sha256').update(token).digest('hex');

export const commands = {
  ready: (requestId: string, expectedSettingsRevision = 0) => ({ v: 1, type: 'ready', requestId, payload: { expectedSettingsRevision } }),
  settings: (requestId: string, target: number, expectedSettingsRevision = 0) => ({
    v: 1,
    type: 'update-settings',
    requestId,
    payload: { expectedSettingsRevision, settings: { target, drawEnabled: true } },
  }),
  choice: (requestId: string, matchId: string, roundId: number, element: string) => ({
    v: 1,
    type: 'submit-choice',
    requestId,
    matchId,
    roundId,
    payload: { element },
  }),
  rematch: (requestId: string, matchId: string, expectedSettingsRevision = 0) => ({
    v: 1,
    type: 'rematch-ready',
    requestId,
    matchId,
    payload: { expectedSettingsRevision },
  }),
  leave: (requestId: string) => ({ v: 1, type: 'leave', requestId, payload: {} }),
};

export type Driver = ReturnType<typeof createDriver>;

export function createDriver(server: TestHarness) {
  /** Sockets ouvertes par le test courant : `closeAll` les ferme après lui. */
  const open: SocketProbe[] = [];
  let barrier = 0;

  async function post(path: string): Promise<RoomEntry> {
    const response = await server.fetch(path, { method: 'POST' });
    const entry = parseRoomEntry(await response.json());
    if (entry === null) throw new Error(`Entrée refusée : ${String(response.status)}`);
    return entry;
  }

  /** Socket authentifiée par son token : son premier `state` (reçu avant l'ack) et la socket. */
  async function connect(code: string, token: string, requestId = 'auth-1'): Promise<{ probe: SocketProbe; snapshot: Frame }> {
    const probe = await openSocket(server, code);
    open.push(probe);
    probe.send({ v: 1, type: 'authenticate', requestId, payload: { resumeToken: token } });
    const snapshot = await probe.next();
    expect(snapshot).toMatchObject({ type: 'state' });
    expect(await probe.next()).toMatchObject({ type: 'ack', requestId });
    return { probe, snapshot };
  }

  /** Room à deux joueurs connectés, au lobby ; création et connexions à l'instant `at`. */
  async function duel(at = T0): Promise<Duel> {
    await setClock(server, at);
    const host = await post('/api/rooms');
    const guest = await post(`/api/rooms/${host.roomCode}/join`);
    const first = await connect(host.roomCode, host.resumeToken);
    const second = await connect(host.roomCode, guest.resumeToken);
    expect(await first.probe.next()).toMatchObject({ type: 'state', connected: [true, true] });
    return { code: host.roomCode, tokens: [host.resumeToken, guest.resumeToken], host: first.probe, guest: second.probe };
  }

  async function state(code: string): Promise<PersistedRoom> {
    const found = await readRoom(server, code);
    if (found === null) throw new Error(`Room ${code} absente.`);
    return found;
  }

  /** Envoie une commande et lit jusqu'à sa réponse (`ack` ou `error`) ; rend les trames publiées avant. */
  async function send(probe: SocketProbe, frame: { requestId: string }): Promise<{ published: Frame[]; reply: Frame }> {
    probe.send(frame);
    const published: Frame[] = [];
    for (;;) {
      const next = await probe.next();
      if ((next['type'] === 'ack' || next['type'] === 'error') && next['requestId'] === frame.requestId) {
        return { published, reply: next };
      }
      published.push(next);
    }
  }

  /** Barrière observable : les trames reçues avant le pong d'un ping (le serveur traite dans l'ordre). */
  async function drain(probe: SocketProbe): Promise<Frame[]> {
    barrier += 1;
    const requestId = `barrier-${String(barrier)}`;
    probe.send({ v: 1, type: 'ping', requestId, payload: {} });
    const before: Frame[] = [];
    for (;;) {
      const frame = await probe.next();
      if (frame['type'] === 'pong' && frame['requestId'] === requestId) return before;
      before.push(frame);
    }
  }

  /** Avance l'horloge à `now` puis exécute l'alarme de la room ; rend la prochaine alarme planifiée. */
  async function tick(code: string, now: number): Promise<number | null> {
    await setClock(server, now);
    const result = await runAlarm(server, code);
    expect(result.failed).toBe(false);
    return result.alarm;
  }

  /** Les deux joueurs confirment à `at`, puis l'ouverture s'écoule : manche 1 en sélection. Rend le matchId. */
  async function start(d: Duel, at = T0, settingsRevision = 0): Promise<string> {
    await setClock(server, at);
    await send(d.host, commands.ready('ready-h', settingsRevision));
    await send(d.guest, commands.ready('ready-g', settingsRevision));
    await tick(d.code, at + INTRO_MS);
    await drain(d.host);
    await drain(d.guest);
    const { match, phase } = await state(d.code);
    expect(phase).toBe('selecting');
    return match?.id ?? '';
  }

  function closeAll(): void {
    for (const probe of open.splice(0)) probe.close();
  }

  return { post, connect, duel, state, send, drain, tick, start, closeAll };
}
