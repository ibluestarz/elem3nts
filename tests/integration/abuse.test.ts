import type { TestHarness } from 'wrangler';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SOCKET_CLOSE_CODES } from '../../src/shared/protocol/index.ts';
import { commands, createDriver, sha256, T0, type Driver } from './driver.ts';
import {
  alarm,
  CLIENT_IP_HEADER,
  closedWith,
  failCommits,
  openSocket,
  readRoom,
  runAlarm,
  runLimiterAlarm,
  setClock,
  startHarness,
  structuredLogs,
  type LogEntry,
} from './support.ts';

/**
 * PFC-020 — abus et observabilité, dans le vrai runtime Workers (workerd) : limites de débit par IP du
 * Worker de production (limiteur Durable Object, horloge figée du harnais), plafond de sockets en attente,
 * journal structuré relu depuis workerd. Chaque test impose sa propre adresse cliente (`CLIENT_IP_HEADER`) :
 * les budgets des tests sont indépendants, comme ceux de deux joueurs d'IP différentes.
 */
let server: TestHarness;
let drv: Driver;
let origin: string;

beforeAll(async () => {
  server = await startHarness();
  drv = createDriver(server);
  origin = (await server.listen()).url.origin;
});

afterEach(async () => {
  drv.closeAll();
  await setClock(server, null);
});

afterAll(async () => {
  await server.close();
});

/** Contrat écrit en clair (PROTOCOL « Idempotence et validation », D45). */
const ENTRY_LIMIT = 10;
const SOCKET_LIMIT = 60;
const WINDOW_MS = 60_000;
const RATE_LIMITED = { error: { code: 'RATE_LIMITED', message: 'Trop de tentatives : patientez une minute puis réessayez.' } };

/** Code bien formé d'une room qui n'existe pas. */
const ABSENT_CODE = 'ABCDEFGH';

type HarnessResponse = Awaited<ReturnType<TestHarness['fetch']>>;

function enter(path: string, ip: string, headers: Record<string, string> = {}): Promise<HarnessResponse> {
  return server.fetch(path, { method: 'POST', headers: { [CLIENT_IP_HEADER]: ip, ...headers } });
}

/** Upgrade de même origine lancé par `fetch` : seuls les refus HTTP du Worker (avant toute room) y sont lus. */
function upgrade(code: string, ip: string): Promise<HarnessResponse> {
  return server.fetch(`/api/rooms/${code}/ws`, {
    headers: { upgrade: 'websocket', connection: 'Upgrade', origin, [CLIENT_IP_HEADER]: ip },
  });
}

/** Événements structurés émis depuis `mark` (nombre d'événements relus avant l'action). */
function since(mark: number): LogEntry[] {
  return structuredLogs(server).slice(mark);
}

const count = (entries: readonly LogEntry[], event: string): number => entries.filter((entry) => entry.event === event).length;

describe('PFC-020-S1 — abus de création', () => {
  it('une IP qui a épuisé 10 tentatives dans la minute est limitée sans créer de room ; une autre IP ne l’est pas', async () => {
    await setClock(server, T0);
    const mark = structuredLogs(server).length;
    for (let index = 0; index < ENTRY_LIMIT; index += 1) {
      expect((await enter('/api/rooms', '198.51.100.1')).status).toBe(201);
    }

    const limited = await enter('/api/rooms', '198.51.100.1');

    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(limited.headers.get('cache-control')).toBe('no-store');
    expect(await limited.json()).toEqual(RATE_LIMITED);
    const logs = since(mark);
    // Aucune room créée par la requête limitée : exactement 10 créations journalisées.
    expect(count(logs, 'room.created')).toBe(ENTRY_LIMIT);
    expect(logs.at(-1)).toEqual({ event: 'http.rejected', code: 'RATE_LIMITED', bucket: 'entry' });
    // Joueur légitime d'une autre IP : non affecté.
    expect((await enter('/api/rooms', '198.51.100.2')).status).toBe(201);
    // Même /64 IPv6 : un seul budget ; /64 voisin : budget propre.
    for (let index = 0; index < ENTRY_LIMIT; index += 1) await enter('/api/rooms', `2001:db8:20:1::${String(index + 1)}`);
    expect((await enter('/api/rooms', '2001:db8:20:1:ffff::1')).status).toBe(429);
    expect((await enter('/api/rooms', '2001:db8:20:2::1')).status).toBe(201);
  });

  it('la fenêtre glisse : à 59,999 s encore limitée (Retry-After 1), à 60 s de nouveau admise', async () => {
    await setClock(server, T0);
    for (let index = 0; index < ENTRY_LIMIT; index += 1) await enter('/api/rooms', '198.51.100.3');
    await setClock(server, T0 + WINDOW_MS - 1);
    const late = await enter('/api/rooms', '198.51.100.3');
    expect(late.status).toBe(429);
    expect(late.headers.get('retry-after')).toBe('1');

    await setClock(server, T0 + WINDOW_MS);
    expect((await enter('/api/rooms', '198.51.100.3')).status).toBe(201);
  });

  it('créations et jonctions partagent le budget ; une jonction sur un code inconnu compte aussi (énumération bornée)', async () => {
    await setClock(server, T0);
    const host = (await (await enter('/api/rooms', '198.51.100.4')).json()) as { roomCode: string };
    expect((await enter(`/api/rooms/${host.roomCode}/join`, '198.51.100.4')).status).toBe(200);
    expect((await enter(`/api/rooms/${host.roomCode}/join`, '198.51.100.4')).status).toBe(409);
    for (let index = 0; index < ENTRY_LIMIT - 3; index += 1) {
      expect((await enter(`/api/rooms/${ABSENT_CODE}/join`, '198.51.100.4')).status).toBe(404);
    }

    const limited = await enter(`/api/rooms/${ABSENT_CODE}/join`, '198.51.100.4');

    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual(RATE_LIMITED);
    expect((await enter('/api/rooms', '198.51.100.4')).status).toBe(429);
  });

  it('quota atomique : 20 créations simultanées d’une même IP → exactement 10 rooms et 10 refus', async () => {
    await setClock(server, T0);
    const mark = structuredLogs(server).length;

    const responses = await Promise.all(Array.from({ length: 20 }, () => enter('/api/rooms', '198.51.100.5')));

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([...Array<number>(10).fill(201), ...Array<number>(10).fill(429)]);
    expect(count(since(mark), 'room.created')).toBe(10);
  });

  it('le limiteur n’efface rien avant la fin de la fenêtre, puis libère tout le stockage de l’IP', async () => {
    await setClock(server, T0);
    for (let index = 0; index < 3; index += 1) await enter('/api/rooms', '198.51.100.6');
    await setClock(server, T0 + 30_000);
    await enter('/api/rooms', '198.51.100.6');

    await setClock(server, T0 + WINDOW_MS);
    // Tentatives de T0 sorties ; celle de T0 + 30 s reste : prochaine alarme à T0 + 90 s.
    expect(await runLimiterAlarm(server, 'v4:198.51.100.6')).toBe(T0 + 30_000 + WINDOW_MS);
    await setClock(server, T0 + 30_000 + WINDOW_MS);
    expect(await runLimiterAlarm(server, 'v4:198.51.100.6')).toBeNull();
    const sql = await server.getWorker().getDurableObjectStorage('LIMITER', { name: 'v4:198.51.100.6' });
    const stored = (await sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_cf_KV'")) as unknown as unknown[];
    const rows = stored.length === 0 ? [] : ((await sql.exec('SELECT key FROM _cf_KV')) as unknown as unknown[]);
    expect(rows).toEqual([]);
  });
});

describe('PFC-020-AC3 — origine des créations et jonctions (Fetch Metadata)', () => {
  it.each<[string, string, Record<string, string>]>([
    ['Origin d’un autre site', '203.0.113.1', { origin: 'https://evil.example' }],
    ['Origin null', '203.0.113.2', { origin: 'null' }],
    ['Sec-Fetch-Site cross-site', '203.0.113.3', { 'sec-fetch-site': 'cross-site' }],
    ['Sec-Fetch-Site same-site', '203.0.113.4', { 'sec-fetch-site': 'same-site' }],
  ])('%s : 403 ORIGIN_FORBIDDEN avant toute room, sans consommer le budget de l’IP', async (_, ip, headers) => {
    await setClock(server, T0);
    const mark = structuredLogs(server).length;
    for (let index = 0; index < ENTRY_LIMIT + 2; index += 1) {
      const response = await enter(index % 2 === 0 ? '/api/rooms' : `/api/rooms/${ABSENT_CODE}/join`, ip, headers);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: { code: 'ORIGIN_FORBIDDEN', message: 'Origine non autorisée.' } });
    }
    expect(count(since(mark), 'room.created')).toBe(0);

    // Le budget du navigateur visé reste entier : ses 10 requêtes de même origine passent.
    for (let index = 0; index < ENTRY_LIMIT; index += 1) {
      expect((await enter('/api/rooms', ip, { origin, 'sec-fetch-site': 'same-origin' })).status).toBe(201);
    }
    expect((await enter('/api/rooms', ip, { origin, 'sec-fetch-site': 'same-origin' })).status).toBe(429);
  });

  it('sans Origin ni Sec-Fetch-Site (client hors navigateur) : admis, la limite de débit s’applique seule', async () => {
    await setClock(server, T0);
    expect((await enter('/api/rooms', '203.0.113.90')).status).toBe(201);
  });
});

describe('PFC-020-AC1 — budgets des sockets', () => {
  it('60 ouvertures par minute et par IP, puis 429 avant toute room ; le budget des créations reste entier', async () => {
    await setClock(server, T0);
    const mark = structuredLogs(server).length;
    for (let index = 0; index < SOCKET_LIMIT; index += 1) {
      const probe = await openSocket(server, ABSENT_CODE, undefined, '198.51.100.7');
      expect(await closedWith(probe)).toBe(SOCKET_CLOSE_CODES.ROOM_UNAVAILABLE);
    }

    const limited = await upgrade(ABSENT_CODE, '198.51.100.7');

    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(await limited.json()).toEqual(RATE_LIMITED);
    const logs = since(mark);
    // La 61e n'atteint aucune room : 60 refus de room, un seul refus du Worker.
    expect(count(logs, 'socket.refused')).toBe(SOCKET_LIMIT);
    expect(logs.at(-1)).toEqual({ event: 'http.rejected', code: 'RATE_LIMITED', bucket: 'socket' });
    expect((await enter('/api/rooms', '198.51.100.7')).status).toBe(201);
    expect((await upgrade(ABSENT_CODE, '198.51.100.8')).status).not.toBe(429);
  });

  it('plafond de 2 sockets en attente par room : la plus ancienne est fermée (4408, sans trame), les joueurs jouent', async () => {
    const d = await drv.duel();
    const mark = structuredLogs(server).length;
    const first = await openSocket(server, d.code);
    const second = await openSocket(server, d.code);

    const third = await openSocket(server, d.code);

    expect(await closedWith(first)).toBe(SOCKET_CLOSE_CODES.AUTH_TIMEOUT);
    expect(first.raw).toEqual([]);
    // Les deux plus récentes restent ouvertes et traitées : une trame autre qu'`authenticate` → 4401.
    for (const probe of [second, third]) {
      probe.send(commands.ready('pas-authentifie'));
      expect(await closedWith(probe)).toBe(SOCKET_CLOSE_CODES.UNAUTHORIZED);
    }
    expect(count(since(mark), 'socket.evicted')).toBe(1);
    // Les sockets authentifiées ne sont ni comptées ni fermées.
    expect((await drv.send(d.host, commands.ready('ready-h'))).reply).toMatchObject({ type: 'ack' });
    expect((await drv.send(d.guest, commands.ready('ready-g'))).reply).toMatchObject({ type: 'ack' });
    expect((await readRoom(server, d.code))?.connected).toEqual([true, true]);
  });
});

describe('PFC-020-S2 — journal des rejets', () => {
  it('un message malformé contenant un token est journalisé par son code, sans token, empreinte ni charge', async () => {
    const d = await drv.duel(T0);
    const [hostToken, guestToken] = d.tokens;
    const mark = structuredLogs(server).length;

    // Première trame malformée (champ inconnu) portant le token en `requestId` et en charge.
    const pending = await openSocket(server, d.code);
    pending.sendRaw(
      JSON.stringify({ v: 1, type: 'authenticate', requestId: hostToken, payload: { resumeToken: hostToken, marqueur: 'charge-secrete' } }),
    );
    expect(await pending.next()).toMatchObject({ type: 'error', code: 'INVALID_MESSAGE' });
    expect(await closedWith(pending)).toBe(SOCKET_CLOSE_CODES.UNAUTHORIZED);
    // Joueur authentifié : trame malformée portant le token de l'autre place.
    d.guest.sendRaw(`{"v":1,"type":"leave","requestId":"x","payload":{"resumeToken":"${hostToken}"}}`);
    expect(await d.guest.next()).toMatchObject({ type: 'error', code: 'INVALID_MESSAGE' });
    // Reprise valide dont le `requestId` est le token lui-même (identifiant bien formé).
    const retaken = await openSocket(server, d.code);
    retaken.send({ v: 1, type: 'authenticate', requestId: guestToken.slice(0, 43), payload: { resumeToken: guestToken } });
    expect(await retaken.next()).toMatchObject({ type: 'state' });
    expect(await closedWith(d.guest)).toBe(SOCKET_CLOSE_CODES.REPLACED);
    retaken.close();

    const logs = since(mark);
    expect(logs).toContainEqual(expect.objectContaining({ event: 'message.rejected', code: 'INVALID_MESSAGE' }));
    expect(logs).toContainEqual(expect.objectContaining({ event: 'message.rejected', code: 'INVALID_MESSAGE', slot: 1 }));
    expect(logs).toContainEqual(expect.objectContaining({ event: 'socket.authenticated', slot: 1 }));
    expect(logs).toContainEqual(expect.objectContaining({ event: 'socket.closed', close: SOCKET_CLOSE_CODES.REPLACED, by: 'server', slot: 1 }));
    const raw = JSON.stringify(server.getLogs());
    for (const secret of [hostToken, guestToken, sha256(hostToken), sha256(guestToken), 'charge-secrete', 'resumeToken', d.code]) {
      expect(raw).not.toContain(secret);
    }
  });
});

describe('PFC-020-AC2 — journaux exploitables, erreurs internes non divulguées', () => {
  it('chaque événement d’une room porte son identifiant technique, sa partie, sa manche et sa révision', async () => {
    const d = await drv.duel(T0);
    const mark = structuredLogs(server).length;
    const matchId = await drv.start(d, T0);
    await drv.send(d.host, commands.choice('c-h', matchId, 1, 'fire'));
    const { revision } = await drv.state(d.code);
    await drv.send(d.guest, commands.leave('bye'));
    expect(await closedWith(d.host)).toBe(SOCKET_CLOSE_CODES.ROOM_UNAVAILABLE);

    const logs = since(mark);
    const rooms = new Set(logs.map((entry) => entry['room']));
    expect(rooms.size).toBe(1);
    expect([...rooms][0]).toMatch(/^[0-9a-f]{64}$/);
    expect(logs).toContainEqual({
      event: 'command.applied',
      room: [...rooms][0],
      phase: 'selecting',
      match: matchId,
      round: 1,
      revision,
      slot: 0,
      command: 'submit-choice',
    });
    // Première confirmation au lobby ; la seconde ouvre la partie (même révision que son ouverture).
    expect(logs).toContainEqual(expect.objectContaining({ event: 'command.applied', command: 'ready', slot: 0, phase: 'lobby', match: null }));
    expect(logs).toContainEqual(expect.objectContaining({ event: 'command.applied', command: 'ready', slot: 1, phase: 'starting', match: matchId }));
    expect(logs).toContainEqual(expect.objectContaining({ event: 'room.advanced', phase: 'selecting', match: matchId, round: 1 }));
    expect(logs).toContainEqual(expect.objectContaining({ event: 'room.closed', reason: 'left', slot: 1, match: matchId }));
    expect(logs).toContainEqual(expect.objectContaining({ event: 'socket.closed', close: SOCKET_CLOSE_CODES.ROOM_UNAVAILABLE, by: 'server', slot: 0 }));
    // Jamais le choix : un élément n'apparaît dans aucun événement.
    expect(JSON.stringify(logs)).not.toMatch(/fire|water|plant/);
  });

  it('panne pendant une trame (1011) et alarme en échec : nom de l’erreur seul, jamais son message', async () => {
    const d = await drv.duel(T0);
    const matchId = await drv.start(d, T0);
    const mark = structuredLogs(server).length;
    await failCommits(server, d.code, 1);
    d.host.send(commands.choice('c-h', matchId, 1, 'water'));
    expect(await closedWith(d.host)).toBe(1011);
    // J1 absent : la manche est en pause, l'alarme porte l'échéance de reconnexion ; son écriture échoue.
    expect(await drv.drain(d.guest)).toContainEqual(expect.objectContaining({ phase: 'paused' }));
    const reconnectAt = await alarm(server, d.code);
    expect(reconnectAt).not.toBeNull();
    await failCommits(server, d.code, 1);
    await setClock(server, reconnectAt ?? 0);
    expect((await runAlarm(server, d.code)).failed).toBe(true);

    const logs = since(mark);
    expect(logs).toContainEqual(expect.objectContaining({ event: 'socket.internal', close: 1011, error: 'Error', match: matchId }));
    expect(logs).toContainEqual(expect.objectContaining({ event: 'seat.absent', slot: 0, phase: 'paused' }));
    expect(logs).toContainEqual(expect.objectContaining({ event: 'alarm.failed', error: 'Error', phase: 'paused' }));
    expect(JSON.stringify(server.getLogs())).not.toContain('Panne de stockage simulée');
  });

  it('toute réponse JSON de l’API porte les en-têtes de sécurité', async () => {
    await setClock(server, T0);
    for (let index = 0; index < ENTRY_LIMIT; index += 1) await enter('/api/rooms', '198.51.100.9');
    const responses = [
      await enter('/api/rooms', '198.51.100.10'),
      await server.fetch('/api/inconnue'),
      await enter('/api/rooms', '198.51.100.9'),
      await enter('/api/rooms', '198.51.100.11', { origin: 'https://evil.example' }),
    ];
    expect(responses.map((response) => response.status)).toEqual([201, 404, 429, 403]);
    for (const response of responses) {
      expect(Object.fromEntries(response.headers)).toMatchObject({
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
        'cross-origin-resource-policy': 'same-origin',
        'referrer-policy': 'no-referrer',
        'x-frame-options': 'DENY',
      });
    }
  });
});
