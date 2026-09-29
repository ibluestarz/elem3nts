import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { TestHarness } from 'wrangler';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ROOM_IDLE_TIMEOUT_MS, parseRoomEntry, parseServerMessage, type RoomEntry } from '../../src/shared/protocol/index.ts';
import type { PersistedRoom } from '../../src/worker/codec.ts';
import {
  alarm,
  closedWith,
  openSocket,
  readRoom,
  rebuild,
  rows,
  setClock,
  startHarness,
  tables,
  type SocketProbe,
} from './support.ts';

let server: TestHarness;

beforeAll(async () => {
  server = await startHarness();
});

afterEach(async () => {
  await setClock(server, null);
});

afterAll(async () => {
  await server.close();
});

/** Instant figé (2033) : les alarmes réelles planifiées sous cette horloge ne se déclenchent jamais. */
const T0 = 2_000_000_000_000;

/** Valeurs de PROTOCOL / PFC-013, écrites en clair pour vérifier le contrat. */
const AUTH_TIMEOUT_MS = 5000;
const RESERVATION_TTL_MS = 30_000;
const CLOSE = { unauthorized: 4401, unavailable: 4404, authTimeout: 4408, replaced: 4409, limits: 4429 } as const;

const MESSAGES = {
  UNAUTHORIZED: 'Connexion non reconnue : rejoignez la partie à nouveau.',
  ROOM_UNAVAILABLE: 'Cette partie n’existe pas ou n’est plus disponible.',
  NOT_HOST: 'Seul Joueur 1 peut modifier les réglages.',
  INVALID_MESSAGE: 'Message invalide : il a été ignoré.',
  INVALID_PHASE: 'Action impossible à ce moment de la partie.',
  RATE_LIMITED: 'Trop de messages envoyés : patientez un instant.',
} as const;

function error(code: keyof typeof MESSAGES, requestId?: string): Record<string, unknown> {
  return { v: 1, type: 'error', ...(requestId === undefined ? {} : { requestId }), code, message: MESSAGES[code] };
}

async function post(path: string): Promise<RoomEntry> {
  const response = await server.fetch(path, { method: 'POST' });
  const entry = parseRoomEntry(await response.json());
  if (entry === null) throw new Error(`Entrée refusée : ${String(response.status)}`);
  return entry;
}

/** Room créée par J1 et rejointe par J2 : deux tokens réels, deux places réservées. */
async function room(): Promise<{ code: string; host: string; guest: string }> {
  const host = await post('/api/rooms');
  const guest = await post(`/api/rooms/${host.roomCode}/join`);
  return { code: host.roomCode, host: host.resumeToken, guest: guest.resumeToken };
}

async function state(code: string): Promise<PersistedRoom> {
  const found = await readRoom(server, code);
  if (found === null) throw new Error(`Room ${code} absente.`);
  return found;
}

function authenticate(token: string, requestId = 'auth-1'): unknown {
  return { v: 1, type: 'authenticate', requestId, payload: { resumeToken: token } };
}

function ping(requestId: string): unknown {
  return { v: 1, type: 'ping', requestId, payload: {} };
}

function sha256(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Ouvre et authentifie une socket ; rend la socket et le `state` reçu (suivi de l'ack). */
async function connect(code: string, token: string): Promise<{ probe: SocketProbe; snapshot: Record<string, unknown> }> {
  const probe = await openSocket(server, code);
  probe.send(authenticate(token));
  const snapshot = await probe.next();
  expect(snapshot['type']).toBe('state');
  expect(await probe.next()).toMatchObject({ type: 'ack', requestId: 'auth-1' });
  return { probe, snapshot };
}

/**
 * Barrière observable (aucune attente arbitraire) : un ping renvoie son pong ; toute trame reçue
 * avant lui est rendue. Le serveur traite les trames d'une socket dans l'ordre.
 */
async function drain(probe: SocketProbe, requestId: string): Promise<Record<string, unknown>[]> {
  probe.send(ping(requestId));
  const before: Record<string, unknown>[] = [];
  for (;;) {
    const frame = await probe.next();
    if (frame['type'] === 'pong' && frame['requestId'] === requestId) return before;
    before.push(frame);
  }
}

/**
 * Requête HTTP brute (node:http), même origine : `fetch` refuse d'envoyer `Upgrade` et masque les
 * en-têtes de connexion de la réponse, que ces cas vérifient justement.
 */
async function rawRequest(
  method: string,
  path: string,
  upgrade: boolean,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const { url } = await server.listen();
  const headers: Record<string, string> = { origin: url.origin };
  if (upgrade) Object.assign(headers, { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' });
  return new Promise((resolve, reject) => {
    const request = httpRequest(new URL(path, url), { method, headers }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body });
      });
    });
    request.on('upgrade', () => {
      reject(new Error('Upgrade accepté à tort.'));
    });
    request.on('error', reject);
    request.end();
  });
}

/** Aucune trame reçue par la socket ne porte un token ou une empreinte, et chacune respecte le schéma. */
function expectClean(probe: SocketProbe, ...secrets: string[]): void {
  for (const frame of probe.raw) {
    expect(parseServerMessage(frame).ok).toBe(true);
    for (const secret of secrets) {
      expect(frame).not.toContain(secret);
      expect(frame).not.toContain(sha256(secret));
    }
  }
}

describe('PFC-013-AC1 — authentification dans les 5 s', () => {
  it('PFC-013-S1 — J2 authentifie sa socket avec son resumeToken : état projeté pour J2, place connectée', async () => {
    const { code, host, guest } = await room();

    const { probe, snapshot } = await connect(code, guest);

    expect(snapshot).toMatchObject({
      v: 1,
      type: 'state',
      roomCode: code,
      yourSlot: 1,
      phase: 'lobby',
      connected: [false, true],
      ready: [false, false],
    });
    const persisted = await state(code);
    expect(persisted.connected).toEqual([false, true]);
    expect(persisted.seats[1]).toEqual({ tokenHash: sha256(guest), reservedUntil: null });
    // J1 attend toujours sa première connexion : sa réservation n'est pas touchée.
    expect(persisted.seats[0]?.reservedUntil).not.toBeNull();
    expect(snapshot['revision']).toBe(persisted.revision);
    expectClean(probe, host, guest);
    probe.close();
  });

  it('la connexion de J1 est publiée à J2, déjà présent ; chaque état est projeté pour sa place', async () => {
    const { code, host, guest } = await room();
    const second = await connect(code, guest);

    const first = await connect(code, host);

    expect(first.snapshot).toMatchObject({ yourSlot: 0, connected: [true, true] });
    expect(await second.probe.next()).toMatchObject({ type: 'state', yourSlot: 1, connected: [true, true] });
    const persisted = await state(code);
    expect(persisted.seats.map((seat) => seat?.reservedUntil)).toEqual([null, null]);
    // Plus aucune réservation ni socket en attente : seule reste l'inactivité (PFC-018), depuis la dernière
    // première connexion.
    expect(await alarm(server, code)).toBe(persisted.lastActivityAt + ROOM_IDLE_TIMEOUT_MS);
    expectClean(first.probe, host, guest);
    expectClean(second.probe, host, guest);
    first.probe.close();
    second.probe.close();
  });

  it('sans authentification, la socket est fermée à 5 s (horloge réelle), sans aucune trame', async () => {
    const { code, host, guest } = await room();
    const probe = await openSocket(server, code);
    const opened = performance.now();

    expect(await closedWith(probe)).toBe(CLOSE.authTimeout);

    const elapsed = performance.now() - opened;
    expect(elapsed).toBeGreaterThanOrEqual(AUTH_TIMEOUT_MS - 250);
    expect(elapsed).toBeLessThan(AUTH_TIMEOUT_MS + 3000);
    expect(probe.raw).toEqual([]);
    expect((await state(code)).connected).toEqual([false, false]);
    expectClean(probe, host, guest);
  });

  it('un authenticate arrivé à l’instant exact de l’échéance est trop tardif : fermeture sans snapshot', async () => {
    await setClock(server, T0);
    const { code, guest } = await room();
    const probe = await openSocket(server, code);
    const before = await state(code);

    await setClock(server, T0 + AUTH_TIMEOUT_MS);
    probe.send(authenticate(guest));

    expect(await closedWith(probe)).toBe(CLOSE.authTimeout);
    expect(probe.raw).toEqual([]);
    expect(await state(code)).toEqual(before);
  });

  it('juste avant l’échéance, l’authentification réussit', async () => {
    await setClock(server, T0);
    const { code, guest } = await room();
    const probe = await openSocket(server, code);

    await setClock(server, T0 + AUTH_TIMEOUT_MS - 1);
    probe.send(authenticate(guest));

    expect(await probe.next()).toMatchObject({ type: 'state', yourSlot: 1, serverNow: T0 + AUTH_TIMEOUT_MS - 1 });
    probe.close();
  });

  it('l’échéance d’authentification est portée par l’alarme unique de la room', async () => {
    await setClock(server, T0);
    const { code } = await room();
    const probe = await openSocket(server, code);
    // Plus proche échéance : la socket (5 s), avant les réservations (30 s).
    expect(await alarm(server, code)).toBe(T0 + AUTH_TIMEOUT_MS);

    await setClock(server, T0 + AUTH_TIMEOUT_MS - 1);
    expect(await alarm(server, code, true)).toBe(T0 + AUTH_TIMEOUT_MS);
    await setClock(server, T0 + AUTH_TIMEOUT_MS);

    expect(await alarm(server, code, true)).toBe(T0 + RESERVATION_TTL_MS);
    expect(await closedWith(probe)).toBe(CLOSE.authTimeout);
    expect(probe.raw).toEqual([]);
  });

  it.each([
    ['token bien formé mais inconnu', 'Zml4dHVyZS10b2tlbi1ub3QtYS1zZWNyZXQtMDAwMzI', 'UNAUTHORIZED', 'auth-1'],
    ['token hors format', 'trop-court', 'INVALID_MESSAGE', 'auth-1'],
  ] as const)('%s : erreur sans donnée de room, puis fermeture 4401', async (_, token, code, requestId) => {
    const { code: roomCode, host, guest } = await room();
    const before = await state(roomCode);
    const probe = await openSocket(server, roomCode);

    probe.send(authenticate(token));

    expect(await probe.next()).toEqual(error(code, requestId));
    expect(await closedWith(probe)).toBe(CLOSE.unauthorized);
    expect(probe.raw).toHaveLength(1);
    expect(await state(roomCode)).toEqual(before);
    expectClean(probe, host, guest);
  });

  it.each<[string, string | Uint8Array<ArrayBuffer>, Record<string, unknown>]>([
    ['une commande autre qu’authenticate', JSON.stringify(ping('p-1')), error('UNAUTHORIZED', 'p-1')],
    ['une trame non JSON', '{', error('INVALID_MESSAGE')],
    ['une trame binaire', new Uint8Array([1, 2, 3]), error('INVALID_MESSAGE')],
    [
      'un authenticate qui désigne une place',
      JSON.stringify({ ...(authenticate('x') as object), slot: 0 }),
      error('INVALID_MESSAGE', 'auth-1'),
    ],
  ])('avant authentification, %s : erreur puis fermeture 4401, aucune donnée de room', async (_, frame, expected) => {
    const { code, host, guest } = await room();
    const probe = await openSocket(server, code);

    probe.sendRaw(frame);

    expect(await probe.next()).toEqual(expected);
    expect(await closedWith(probe)).toBe(CLOSE.unauthorized);
    expect(probe.raw).toHaveLength(1);
    expectClean(probe, host, guest);
  });

  it('réservation de J2 échue à l’instant de l’authentification : place libérée d’abord, token refusé', async () => {
    await setClock(server, T0);
    const { code, host: hostToken, guest } = await room();
    const host = await connect(code, hostToken);
    await setClock(server, T0 + RESERVATION_TTL_MS - 1);
    const probe = await openSocket(server, code);

    await setClock(server, T0 + RESERVATION_TTL_MS);
    probe.send(authenticate(guest));

    expect(await probe.next()).toEqual(error('UNAUTHORIZED', 'auth-1'));
    expect(await closedWith(probe)).toBe(CLOSE.unauthorized);
    // La libération est publiée à J1, présent.
    expect(await host.probe.next()).toMatchObject({ type: 'state', yourSlot: 0, connected: [true, false] });
    const persisted = await state(code);
    expect(persisted.seats[1]).toBeNull();
    expect(persisted.connected).toEqual([true, false]);
  });

  it('J1 jamais connecté avant l’échéance : la room est fermée et effacée, la socket reçoit ROOM_UNAVAILABLE', async () => {
    await setClock(server, T0);
    const { code, host } = await room();
    await setClock(server, T0 + RESERVATION_TTL_MS);

    const probe = await openSocket(server, code);
    probe.send(authenticate(host));

    expect(await probe.next()).toEqual(error('ROOM_UNAVAILABLE'));
    expect(await closedWith(probe)).toBe(CLOSE.unavailable);
    expect(await readRoom(server, code)).toBeNull();
    expect(await tables(server, code)).toEqual([]);
  });

  it('code inconnu : socket refusée par ROOM_UNAVAILABLE (4404), aucune room ni stockage créés', async () => {
    const probe = await openSocket(server, 'NEVER234');

    expect(await probe.next()).toEqual(error('ROOM_UNAVAILABLE'));
    expect(await closedWith(probe)).toBe(CLOSE.unavailable);
    expect(await tables(server, 'NEVER234')).toEqual([]);
  });
});

describe('PFC-013-AC2 — une socket authentifiée agit pour sa seule place', () => {
  it('PFC-013-S2 — la socket de J2 tente une commande réservée à J1 : NOT_HOST, sans modification', async () => {
    const { code, host, guest } = await room();
    const first = await connect(code, host);
    const second = await connect(code, guest);
    await first.probe.next();
    const before = await rows(server, code);

    second.probe.send({
      v: 1,
      type: 'update-settings',
      requestId: 'settings-1',
      payload: { expectedSettingsRevision: 0, settings: { target: 5, drawEnabled: false } },
    });

    expect(await second.probe.next()).toEqual(error('NOT_HOST', 'settings-1'));
    expect(await rows(server, code)).toEqual(before);
    // Rien n'est publié à J1, et la socket de J2 reste ouverte.
    expect(await drain(first.probe, 'p-host')).toEqual([]);
    expect(await drain(second.probe, 'p-guest')).toEqual([]);
    expectClean(second.probe, host, guest);
    first.probe.close();
    second.probe.close();
  });

  it('un second authenticate, même avec le token de J1, ne change pas de place : INVALID_PHASE', async () => {
    const { code, host, guest } = await room();
    const second = await connect(code, guest);
    const before = await rows(server, code);

    second.probe.send(authenticate(host, 'auth-2'));

    expect(await second.probe.next()).toEqual(error('INVALID_PHASE', 'auth-2'));
    expect(await rows(server, code)).toEqual(before);
    second.probe.send({ v: 1, type: 'ready', requestId: 'ready-1', payload: { expectedSettingsRevision: 0 } });
    // Toujours J2 : `ready` sans J1 connecté est refusé par la phase, jamais par NOT_HOST ou UNAUTHORIZED.
    expect(await second.probe.next()).toEqual(error('INVALID_PHASE', 'ready-1'));
    second.probe.close();
  });

  it('ping : pong horodaté par le serveur, sans écriture', async () => {
    await setClock(server, T0);
    const { code, guest } = await room();
    const { probe } = await connect(code, guest);
    const before = await rows(server, code);

    await setClock(server, T0 + 1234);
    probe.send(ping('ping-1'));

    expect(await probe.next()).toEqual({ v: 1, type: 'pong', requestId: 'ping-1', serverNow: T0 + 1234 });
    expect(await rows(server, code)).toEqual(before);
    probe.close();
  });

  it('commande de jeu autorisée (PFC-014) : transition persistée, publiée aux deux places, puis acquittée', async () => {
    const { code, host, guest } = await room();
    const first = await connect(code, host);
    const second = await connect(code, guest);
    await first.probe.next();
    const { revision } = await state(code);

    first.probe.send({ v: 1, type: 'ready', requestId: 'ready-1', payload: { expectedSettingsRevision: 0 } });

    expect(await first.probe.next()).toMatchObject({ type: 'state', yourSlot: 0, ready: [true, false], revision: revision + 1 });
    expect(await first.probe.next()).toEqual({ v: 1, type: 'ack', requestId: 'ready-1', revision: revision + 1 });
    expect(await second.probe.next()).toMatchObject({ type: 'state', yourSlot: 1, ready: [true, false] });
    expect((await state(code)).ready).toEqual([true, false]);
    expectClean(first.probe, host, guest);
    first.probe.close();
    second.probe.close();
  });

  it('fermeture de la socket courante : place absente mais conservée, publiée à l’autre joueur ; reprise possible', async () => {
    const { code, host, guest } = await room();
    const first = await connect(code, host);
    const second = await connect(code, guest);
    await first.probe.next();

    second.probe.close();

    expect(await first.probe.next()).toMatchObject({ type: 'state', yourSlot: 0, connected: [true, false] });
    const persisted = await state(code);
    expect(persisted.connected).toEqual([true, false]);
    expect(persisted.seats[1]).toEqual({ tokenHash: sha256(guest), reservedUntil: null });

    const again = await connect(code, guest);
    expect(again.snapshot).toMatchObject({ yourSlot: 1, connected: [true, true] });
    expect(await first.probe.next()).toMatchObject({ connected: [true, true] });
    first.probe.close();
    again.probe.close();
  });
});

describe('PFC-013-AC3 — isolation, génération de socket, Origin et limites', () => {
  it('deux rooms isolées : un token ne vaut que dans sa room, et aucun état ne traverse', async () => {
    const a = await room();
    const b = await room();
    const inA = await connect(a.code, a.host);

    const intruder = await openSocket(server, b.code);
    intruder.send(authenticate(a.host));
    expect(await intruder.next()).toEqual(error('UNAUTHORIZED', 'auth-1'));
    expect(await closedWith(intruder)).toBe(CLOSE.unauthorized);

    const inB = await connect(b.code, b.guest);
    expect(inB.snapshot).toMatchObject({ roomCode: b.code, yourSlot: 1 });
    // La connexion dans B ne produit rien dans A.
    expect(await drain(inA.probe, 'p-a')).toEqual([]);
    expect((await state(a.code)).connected).toEqual([true, false]);
    expect((await state(b.code)).connected).toEqual([false, true]);
    expectClean(inA.probe, b.host, b.guest);
    inA.probe.close();
    inB.probe.close();
  });

  it('une nouvelle socket de la même place remplace l’ancienne : 4409, seule la nouvelle génération agit', async () => {
    const { code, host, guest } = await room();
    const old = await connect(code, host);
    const other = await connect(code, guest);
    await old.probe.next();
    const before = await rows(server, code);

    const fresh = await connect(code, host);

    expect(await closedWith(old.probe)).toBe(CLOSE.replaced);
    // La place était déjà présente : aucune écriture, aucune publication à J2.
    expect(fresh.snapshot).toMatchObject({ yourSlot: 0, connected: [true, true], revision: before[0]?.revision });
    expect(await rows(server, code)).toEqual(before);
    expect(await drain(other.probe, 'p-guest')).toEqual([]);
    // La fermeture de l'ancienne génération ne rend pas J1 absent.
    expect(await drain(fresh.probe, 'p-host')).toEqual([]);
    expect((await state(code)).connected).toEqual([true, true]);
    fresh.probe.close();
    other.probe.close();
  });

  it('reconstruction de l’objet après départ : place reprise depuis l’état durable, sans réservation ; seul le délai de reconnexion reste planifié', async () => {
    const { code, host, guest } = await room();
    const first = await connect(code, host);
    const other = await connect(code, guest);
    await first.probe.next();
    first.probe.close();
    expect(await other.probe.next()).toMatchObject({ connected: [false, true] });
    other.probe.close();
    await closedWith(other.probe);
    await expect.poll(async () => (await state(code)).connected).toEqual([false, false]);
    const before = await rows(server, code);
    // Délai compté depuis la première absence (J1), jamais repoussé par la seconde (PFC-017).
    const { reconnectDeadline } = await state(code);

    // Une socket standard retient l'objet en mémoire (D37) : il n'est reconstruit qu'une fois vide.
    await rebuild(server, code);

    expect(await rows(server, code)).toEqual(before);
    const again = await connect(code, host);
    expect(again.snapshot).toMatchObject({ yourSlot: 0, connected: [true, false] });
    // J2 reste absent : le délai de la première absence reste l'échéance de la room.
    expect(await state(code)).toMatchObject({ connected: [true, false], reconnectDeadline });
    expect(await alarm(server, code)).toBe(reconnectDeadline);
    expectClean(again.probe, host, guest);
    again.probe.close();
  });

  it.each([
    ['d’un autre site', 'https://evil.example'],
    ['du même hôte sur un autre port', 'http://localhost:1'],
    ['null (iframe isolée)', 'null'],
    ['absente', null],
  ])('Origin %s : upgrade refusé en 403 JSON, avant toute room', async (_, origin) => {
    const { code } = await room();
    const before = await rows(server, code);
    const headers: Record<string, string> = { upgrade: 'websocket', connection: 'Upgrade' };
    if (origin !== null) headers['origin'] = origin;

    const response = await server.fetch(`/api/rooms/${code}/ws`, { headers });

    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: { code: 'ORIGIN_FORBIDDEN', message: 'Origine non autorisée.' } });
    expect(await rows(server, code)).toEqual(before);
  });

  it('Origin refusée sur une vraie socket : aucune ouverture, aucune trame, room intacte', async () => {
    const { code } = await room();
    const before = await rows(server, code);

    const probe = await openSocket(server, code, 'https://evil.example');

    expect(await probe.opened).toBe(false);
    expect(probe.raw).toEqual([]);
    expect(await rows(server, code)).toEqual(before);
    expect((await openSocket(server, code, null)).raw).toEqual([]);
  });

  it.each([
    ['POST', 'POST', 'ABSENT23', false, 405, 'METHOD_NOT_ALLOWED', { allow: 'GET' }],
    ['GET sans upgrade', 'GET', 'ABSENT23', false, 426, 'UPGRADE_REQUIRED', {}],
    ['code mal formé', 'GET', 'MAL-FORME', true, 404, 'ROOM_UNAVAILABLE', {}],
  ] as const)('%s : %s → %i %s, aucune room atteinte', async (_, method, roomCode, upgrade, status, code, headers) => {
    const response = await rawRequest(method, `/api/rooms/${roomCode}/ws`, upgrade);

    expect(response.status).toBe(status);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(JSON.parse(response.body)).toMatchObject({ error: { code } });
    for (const [name, value] of Object.entries(headers)) expect(response.headers[name]).toBe(value);
    expect(await tables(server, roomCode)).toEqual([]);
  });

  it('trame de plus de 4 096 octets : INVALID_MESSAGE sans effet ; la troisième consécutive ferme (4429)', async () => {
    const { code, host, guest } = await room();
    const { probe } = await connect(code, guest);
    const before = await rows(server, code);
    const tooLarge = authenticate('x'.repeat(4097));
    const exact = 'é'.repeat(2048); // 4 096 octets UTF-8 exactement : taille admise, JSON invalide.

    probe.send(tooLarge);
    expect(await probe.next()).toEqual(error('INVALID_MESSAGE'));
    probe.send(tooLarge);
    expect(await probe.next()).toEqual(error('INVALID_MESSAGE'));
    // Une trame dans la limite remet le compteur de dépassements consécutifs à zéro.
    probe.sendRaw(exact);
    expect(await probe.next()).toEqual(error('INVALID_MESSAGE'));
    probe.send(tooLarge);
    expect(await probe.next()).toEqual(error('INVALID_MESSAGE'));
    probe.send(tooLarge);
    expect(await probe.next()).toEqual(error('INVALID_MESSAGE'));
    probe.send(tooLarge);

    expect(await closedWith(probe)).toBe(CLOSE.limits);
    // Les trames refusées n'ont rien écrit ; la fermeture 4429 rend seulement la place absente, avec son
    // délai de reconnexion (PFC-017, PROTOCOL « politique de reconnexion »), au lieu d'une présence figée.
    const revision = Number(before[0]?.revision);
    await expect.poll(async () => (await state(code)).revision).toBe(revision + 1);
    expect(await state(code)).toMatchObject({ connected: [false, false], reconnectDeadline: expect.any(Number) as number });
    expectClean(probe, host, guest);
  });

  it('débit : 30 trames en rafale acceptées, puis RATE_LIMITED ; le troisième dépassement consécutif ferme', async () => {
    await setClock(server, T0);
    const { code, guest } = await room();
    const { probe } = await connect(code, guest);
    // `authenticate` a consommé un jeton ; horloge figée : aucun rechargement.
    for (let index = 0; index < 32; index += 1) probe.send(ping(`p-${String(index)}`));

    for (let index = 0; index < 29; index += 1) {
      expect(await probe.next()).toMatchObject({ type: 'pong', requestId: `p-${String(index)}` });
    }
    expect(await probe.next()).toEqual(error('RATE_LIMITED'));
    expect(await probe.next()).toEqual(error('RATE_LIMITED'));
    expect(await closedWith(probe)).toBe(CLOSE.limits);
    expect(probe.raw).toHaveLength(2 + 29 + 2);
  });

  it('débit soutenu de 20 trames/s : les jetons se rechargent avec l’horloge serveur', async () => {
    await setClock(server, T0);
    const { code, guest } = await room();
    const { probe } = await connect(code, guest);
    for (let index = 0; index < 29; index += 1) probe.send(ping(`burst-${String(index)}`));
    for (let index = 0; index < 29; index += 1) await probe.next();

    await setClock(server, T0 + 100); // 100 ms : deux jetons.
    for (const id of ['r-1', 'r-2', 'r-3']) probe.send(ping(id));

    expect(await probe.next()).toMatchObject({ type: 'pong', requestId: 'r-1' });
    expect(await probe.next()).toMatchObject({ type: 'pong', requestId: 'r-2' });
    expect(await probe.next()).toEqual(error('RATE_LIMITED'));
    probe.close();
  });

  it('trame binaire d’une socket authentifiée : INVALID_MESSAGE, la socket reste utilisable', async () => {
    const { code, guest } = await room();
    const { probe } = await connect(code, guest);

    probe.sendRaw(new Uint8Array([123, 125]));

    expect(await probe.next()).toEqual(error('INVALID_MESSAGE'));
    expect(await drain(probe, 'still-open')).toEqual([]);
    probe.close();
  });
});
