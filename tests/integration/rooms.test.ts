import { createHash } from 'node:crypto';
import type { TestHarness } from 'wrangler';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ROOM_CODE_ALPHABET,
  isResumeToken,
  parseRoomEntry,
  projectState,
  type RoomEntry,
} from '../../src/shared/protocol/index.ts';
import type { PersistedRoom } from '../../src/worker/codec.ts';
import { alarm, execSql, openSocket, readRoom, rebuild, rows, setClock, startHarness, tables, type SocketProbe } from './support.ts';

let server: TestHarness;

beforeAll(async () => {
  server = await startHarness();
});

/** Sockets authentifiées des tests : une place n'est présente que tenue par une socket vivante (PFC-017). */
const sockets: SocketProbe[] = [];

afterEach(async () => {
  for (const probe of sockets.splice(0)) probe.close();
  await setClock(server, null);
});

afterAll(async () => {
  await server.close();
});

/**
 * Instant figé des tests d'échéance, dans le futur (2033) : les alarmes réelles qu'ils planifient ne
 * se déclenchent jamais pendant la suite ; seul `alarm(…, true)` exécute leur traitement.
 */
const T0 = 2_000_000_000_000;
/** Inactivité maximale d'une room (D16, PFC-018) : 30 min. */
const IDLE_MS = 30 * 60_000;

/** Valeurs de PROTOCOL « Transport et entrée dans une room », écrites en clair pour vérifier le contrat. */
const RESERVATION_TTL_MS = 30_000;
const MAX_CODE_ATTEMPTS = 5;

const ROOM_UNAVAILABLE = { error: { code: 'ROOM_UNAVAILABLE', message: 'Cette partie n’existe pas ou n’est plus disponible.' } };
const ROOM_FULL = { error: { code: 'ROOM_FULL', message: 'Cette partie est déjà complète.' } };

interface Reply {
  readonly status: number;
  readonly headers: Awaited<ReturnType<TestHarness['fetch']>>['headers'];
  readonly body: unknown;
}

async function reply(response: Awaited<ReturnType<TestHarness['fetch']>>): Promise<Reply> {
  return { status: response.status, headers: response.headers, body: await response.json() };
}

/** `POST /api/rooms` de production (code aléatoire). */
async function create(): Promise<Reply> {
  return reply(await server.fetch('/api/rooms', { method: 'POST' }));
}

/** Création de production avec une suite de codes imposée (collisions forcées). */
async function createWith(...codes: string[]): Promise<Reply> {
  return reply(await server.fetch('/__harness/create', { method: 'POST', body: JSON.stringify({ codes }) }));
}

async function join(code: string): Promise<Reply> {
  return reply(await server.fetch(`/api/rooms/${code}/join`, { method: 'POST' }));
}

function entry(result: Reply): RoomEntry {
  const parsed = parseRoomEntry(result.body);
  if (parsed === null) throw new Error(`Réponse d'entrée invalide : ${JSON.stringify(result.body)}`);
  return parsed;
}

async function state(code: string): Promise<PersistedRoom> {
  const room = await readRoom(server, code);
  if (room === null) throw new Error(`Room ${code} absente.`);
  return room;
}

function sha256(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Authentifie une vraie socket pour la place du token (PFC-013) : présente, sans réservation en attente,
 * tant que la socket vit (PFC-017 : une présence écrite sans socket serait réconciliée en absence).
 */
async function connect(code: string, token: string): Promise<PersistedRoom> {
  const probe = await openSocket(server, code);
  sockets.push(probe);
  probe.send({ v: 1, type: 'authenticate', requestId: 'auth-1', payload: { resumeToken: token } });
  for (;;) {
    const frame = await probe.next();
    if (frame['type'] === 'ack') break;
  }
  return state(code);
}

function expectPrivateJson(result: Reply): void {
  expect(result.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(result.headers.get('cache-control')).toBe('no-store');
  expect(result.headers.get('x-content-type-options')).toBe('nosniff');
}

describe('PFC-012-AC1 — créer réserve J1', () => {
  it('POST /api/rooms : 201, code de 8 caractères non ambigus, J1 et token 256 bits', async () => {
    const created = await create();

    expect(created.status).toBe(201);
    expectPrivateJson(created);
    const { roomCode, slot, resumeToken } = entry(created);
    expect(slot).toBe(0);
    expect(roomCode).toMatch(new RegExp(`^[${ROOM_CODE_ALPHABET}]{8}$`));
    expect(isResumeToken(resumeToken)).toBe(true);
  });

  it('la room créée est au lobby, J1 réservé 30 s par le seul hash de son token, alarme à l’échéance', async () => {
    await setClock(server, T0);
    const { roomCode, resumeToken } = entry(await createWith('CREATE22'));

    expect(await state(roomCode)).toEqual({
      revision: 1,
      roomCode,
      phase: 'lobby',
      resumePhase: null,
      settings: { target: 3, drawEnabled: true },
      settingsRevision: 0,
      match: null,
      roundId: null,
      selection: [null, null],
      lastRound: null,
      trophies: [0, 0],
      ready: [false, false],
      connected: [false, false],
      deadline: null,
      createdAt: T0,
      seats: [{ tokenHash: sha256(resumeToken), reservedUntil: T0 + RESERVATION_TTL_MS }, null],
      lastActivityAt: T0,
      settledMatchId: null,
      replies: [[], []],
      reconnectDeadline: null,
      resumeRemainingMs: null,
    });
    expect(await alarm(server, roomCode)).toBe(T0 + RESERVATION_TTL_MS);
  });

  it('des créations successives donnent des codes et des tokens tous distincts', async () => {
    const entries = await Promise.all(Array.from({ length: 8 }, async () => entry(await create())));
    expect(new Set(entries.map((created) => created.roomCode)).size).toBe(8);
    expect(new Set(entries.map((created) => created.resumeToken)).size).toBe(8);
  });
});

describe('PFC-012-S1 — Invitation', () => {
  it('PFC-012-S1 — un invité rejoint avec le code : J2 réservé, token privé distinct de celui de J1', async () => {
    // Étant donné une room active contient seulement J1
    const host = entry(await create());
    // La réservation survit à une reconstruction de l'objet (réveil, redéploiement).
    await rebuild(server, host.roomCode);

    // Quand un invité rejoint avec son code
    const joined = await join(host.roomCode);

    // Alors J2 est réservé et un token privé distinct lui est remis
    expect(joined.status).toBe(200);
    expectPrivateJson(joined);
    const guest = entry(joined);
    expect(guest.roomCode).toBe(host.roomCode);
    expect(guest.slot).toBe(1);
    expect(guest.resumeToken).not.toBe(host.resumeToken);
    const room = await state(host.roomCode);
    expect(room.revision).toBe(2);
    expect(room.seats.map((seat) => seat?.tokenHash)).toEqual([sha256(host.resumeToken), sha256(guest.resumeToken)]);
    expect(room.connected).toEqual([false, false]);
  });

  it.each([
    ['minuscules', (code: string) => code.toLowerCase()],
    ['espaces de bord', (code: string) => `%20${code}%20`],
    ['tabulation et casse mixte', (code: string) => `%09${code.slice(0, 4).toLowerCase()}${code.slice(4)}`],
  ])('le code saisi est normalisé (%s) : J2 réservé sous le code canonique', async (_label, typed) => {
    const host = entry(await create());
    const joined = await join(typed(host.roomCode));
    expect(joined.status).toBe(200);
    expect(entry(joined)).toMatchObject({ roomCode: host.roomCode, slot: 1 });
  });
});

describe('PFC-012-S2 — Course de join', () => {
  it('PFC-012-S2 — douze invités simultanés : un seul obtient J2, tous les autres reçoivent ROOM_FULL', async () => {
    // Étant donné J2 est libre
    const host = entry(await create());

    // Quand des invités rejoignent simultanément
    const results = await Promise.all(Array.from({ length: 12 }, () => join(host.roomCode)));

    // Alors un seul obtient J2 et les autres reçoivent ROOM_FULL
    const winners = results.filter((result) => result.status === 200);
    const losers = results.filter((result) => result.status !== 200);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(11);
    for (const loser of losers) {
      expect(loser.status).toBe(409);
      expect(loser.body).toEqual(ROOM_FULL);
    }
    const [winner] = winners;
    if (winner === undefined) throw new Error('Aucun gagnant.');
    const room = await state(host.roomCode);
    // Une seule écriture : J2 porte le hash du seul token remis.
    expect(room.revision).toBe(2);
    expect(room.seats[1]?.tokenHash).toBe(sha256(entry(winner).resumeToken));
  });

  it('PFC-012-S2 — trente réservations lancées au même instant dans le runtime : une seule accordée', async () => {
    const host = entry(await create());

    const response = await server.fetch(`/__harness/rooms/${host.roomCode}/burst`, {
      method: 'POST',
      body: JSON.stringify({ count: 30 }),
    });
    const outcomes = (await response.json()) as { kind: string; tokenHash: string }[];

    const reserved = outcomes.filter((outcome) => outcome.kind === 'reserved');
    expect(reserved).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === 'full')).toHaveLength(29);
    const room = await state(host.roomCode);
    expect(room.revision).toBe(2);
    expect(room.seats[1]?.tokenHash).toBe(reserved[0]?.tokenHash);
  });
});

describe('PFC-012-AC2 — troisième, room expirée et code invalide refusés', () => {
  it('un troisième joueur reçoit ROOM_FULL (409) sans aucune écriture', async () => {
    const host = entry(await create());
    expect((await join(host.roomCode)).status).toBe(200);
    const before = await state(host.roomCode);

    const third = await join(host.roomCode);

    expect(third.status).toBe(409);
    expectPrivateJson(third);
    expect(third.body).toEqual(ROOM_FULL);
    expect(await state(host.roomCode)).toEqual(before);
  });

  it('le code ne reprend jamais une place : J2 connecté, un nouvel arrivant reste refusé', async () => {
    const host = entry(await create());
    const guest = entry(await join(host.roomCode));
    await connect(host.roomCode, host.resumeToken);
    const guestConnected = await connect(host.roomCode, guest.resumeToken);
    expect(guestConnected).toMatchObject({ connected: [true, true], seats: [{ reservedUntil: null }, { reservedUntil: null }] });

    expect((await join(host.roomCode)).body).toEqual(ROOM_FULL);
    expect(await state(host.roomCode)).toEqual(guestConnected);
  });

  it.each([
    ['7 caractères', 'K7M2Q9X'],
    ['9 caractères', 'K7M2Q9XAB'],
    ['zéro ambigu', 'K7M2Q9X0'],
    ['O ambigu', 'K7M2Q9XO'],
    ['un ambigu', 'K7M2Q9X1'],
    ['I ambigu', 'K7M2Q9XI'],
    ['espace interne', 'K7M2%20Q9XA'],
    ['retour à la ligne', 'K7M2%0AQ9X'],
    ['barre encodée', 'K7M2%2FQ9X'],
    ['encodage invalide', 'K7M2Q9X%E0%A4%A'],
    ['script', '%3Cscript%3E'],
  ])('code invalide (%s) : 404 ROOM_UNAVAILABLE, aucune donnée reçue renvoyée', async (_label, code) => {
    const response = await server.fetch(`/api/rooms/${code}/join`, { method: 'POST' });
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual(ROOM_UNAVAILABLE);
    expect(body).not.toMatch(/K7M2|script/i);
  });

  it('code bien formé mais inconnu : 404, et le join ne crée jamais la room (aucun stockage alloué)', async () => {
    const result = await join('ABSENT23');
    expect(result.status).toBe(404);
    expectPrivateJson(result);
    expect(result.body).toEqual(ROOM_UNAVAILABLE);
    expect(await readRoom(server, 'ABSENT23')).toBeNull();
    expect(await tables(server, 'ABSENT23')).toEqual([]);
    expect(await alarm(server, 'ABSENT23')).toBeNull();
  });

  it('room expirée (J1 jamais connecté, échéance atteinte) : 404, jamais recréée, stockage effacé', async () => {
    await setClock(server, T0);
    const { roomCode } = entry(await createWith('EXPRD222'));

    // À l'échéance exacte, sans que l'alarme soit passée : l'échéance est traitée avant le join.
    await setClock(server, T0 + RESERVATION_TTL_MS);
    const late = await join(roomCode);

    expect(late.status).toBe(404);
    expect(late.body).toEqual(ROOM_UNAVAILABLE);
    expect(await tables(server, roomCode)).toEqual([]);
    expect(await alarm(server, roomCode)).toBeNull();
    expect((await join(roomCode)).status).toBe(404);
    expect(await tables(server, roomCode)).toEqual([]);
  });

  it('une milliseconde avant l’échéance de J1, la room accepte encore J2', async () => {
    await setClock(server, T0);
    const { roomCode } = entry(await createWith('EARLY222'));
    await setClock(server, T0 + RESERVATION_TTL_MS - 1);
    expect((await join(roomCode)).status).toBe(200);
  });

  it('room illisible : 503 ROOM_UNAVAILABLE, ligne intacte, rien de réécrit', async () => {
    const { roomCode } = entry(await createWith('BRKEN222'));
    await execSql(server, roomCode, 'UPDATE room_state SET state = ?', '{"revision":1}');
    const before = await rows(server, roomCode);
    await rebuild(server, roomCode);

    const result = await join(roomCode);

    expect(result.status).toBe(503);
    expect(result.body).toEqual(ROOM_UNAVAILABLE);
    expect(await rows(server, roomCode)).toEqual(before);
  });
});

describe('PFC-012-AC3 — collision de code sans écrasement', () => {
  it('collision forcée : un autre code est tiré, la room existante reste identique', async () => {
    const first = entry(await createWith('CLASH222'));
    const before = await rows(server, first.roomCode);

    const second = await createWith('CLASH222', 'CLASH222', 'FRESH222');

    expect(second.status).toBe(201);
    expect(entry(second)).toMatchObject({ roomCode: 'FRESH222', slot: 0 });
    expect(entry(second).resumeToken).not.toBe(first.resumeToken);
    expect(await rows(server, first.roomCode)).toEqual(before);
    expect((await state('FRESH222')).seats[0]?.tokenHash).toBe(sha256(entry(second).resumeToken));
  });

  it(`${String(MAX_CODE_ATTEMPTS)} collisions : 503 CODE_COLLISION réessayable, aucun sixième tirage, rien d’écrit`, async () => {
    const first = entry(await createWith('TAKEN222'));
    const before = await rows(server, first.roomCode);

    const result = await createWith(...Array.from({ length: MAX_CODE_ATTEMPTS }, () => 'TAKEN222'), 'NEVER222');

    expect(result.status).toBe(503);
    expectPrivateJson(result);
    expect(result.headers.get('retry-after')).toBe('1');
    expect(result.body).toEqual({
      error: { code: 'CODE_COLLISION', message: 'Impossible de créer une partie pour le moment : réessayez.' },
    });
    expect(await rows(server, first.roomCode)).toEqual(before);
    expect(await tables(server, 'NEVER222')).toEqual([]);
  });

  it('une room illisible sous le code tiré compte comme une collision : jamais écrasée', async () => {
    const { roomCode } = entry(await createWith('CRRUPT22'));
    await execSql(server, roomCode, 'UPDATE room_state SET schema_version = 99');
    const before = await rows(server, roomCode);
    await rebuild(server, roomCode);

    const result = await createWith(roomCode, 'HEALTHY2');

    expect(entry(result).roomCode).toBe('HEALTHY2');
    expect(await rows(server, roomCode)).toEqual(before);
  });

  it('deux créations simultanées sur le même code : une seule l’obtient, l’autre en tire un autre', async () => {
    const results = await Promise.all([createWith('RACE2222', 'RACEA222'), createWith('RACE2222', 'RACEB222')]);

    const codes = results.map((result) => entry(result).roomCode).sort();
    expect(codes).toHaveLength(2);
    expect(codes[0]).not.toBe(codes[1]);
    expect(codes).toContain('RACE2222');
    const race = await state('RACE2222');
    expect(race.revision).toBe(1);
    const owner = results.map(entry).find((created) => created.roomCode === 'RACE2222');
    expect(race.seats[0]?.tokenHash).toBe(sha256(owner?.resumeToken ?? ''));
  });
});

describe('PFC-012-AC3 — token hash seul persisté, jamais publié ni journalisé', () => {
  it('stockage brut, état public et journaux du runtime ne contiennent aucun token', async () => {
    server.clearLogs();
    const host = entry(await create());
    const guest = entry(await join(host.roomCode));
    const tokens = [host.resumeToken, guest.resumeToken];
    const hashes = tokens.map(sha256);

    const [row] = await rows(server, host.roomCode);
    const raw = JSON.stringify(row);
    for (const token of tokens) expect(raw).not.toContain(token);
    for (const hash of hashes) expect(raw).toContain(hash);

    const room = await state(host.roomCode);
    for (const slot of [0, 1] as const) {
      const publicState = JSON.stringify(projectState(room, slot, T0));
      for (const secret of [...tokens, ...hashes]) expect(publicState).not.toContain(secret);
      expect(publicState).not.toMatch(/token|hash|seat/i);
    }

    const logs = JSON.stringify(server.getLogs());
    for (const secret of [...tokens, ...hashes]) expect(logs).not.toContain(secret);
  });

  it('les erreurs (complète, absente) ne portent ni token ni hash', async () => {
    const host = entry(await create());
    await join(host.roomCode);
    const hashes = (await state(host.roomCode)).seats.map((seat) => seat?.tokenHash ?? '');
    const errors = JSON.stringify([(await join(host.roomCode)).body, (await join('ABSENT23')).body]);
    for (const secret of [host.resumeToken, ...hashes]) expect(errors).not.toContain(secret);
  });
});

describe('PFC-012-AC3 — réservation abandonnée nettoyée', () => {
  it('J1 jamais connecté : avant l’échéance rien ne change ; à l’échéance, la room est fermée et effacée', async () => {
    await setClock(server, T0);
    const { roomCode } = entry(await createWith('ABANDN22'));
    const before = await state(roomCode);

    // Alarme traitée en avance (réveil anticipé) : rien d'échu, alarme conservée.
    await setClock(server, T0 + RESERVATION_TTL_MS - 1);
    expect(await alarm(server, roomCode, true)).toBe(T0 + RESERVATION_TTL_MS);
    expect(await state(roomCode)).toEqual(before);

    await setClock(server, T0 + RESERVATION_TTL_MS);
    expect(await alarm(server, roomCode, true)).toBeNull();
    expect(await readRoom(server, roomCode)).toBeNull();
    expect(await tables(server, roomCode)).toEqual([]);

    // Alarme répétée : idempotente, rien n'est recréé.
    expect(await alarm(server, roomCode, true)).toBeNull();
    expect(await tables(server, roomCode)).toEqual([]);
    expect((await join(roomCode)).status).toBe(404);

    // Le code redevient libre : la même instance recrée sa table et une room neuve, révision 1.
    const reused = entry(await createWith(roomCode));
    expect(reused.slot).toBe(0);
    expect(await state(roomCode)).toMatchObject({ revision: 1, seats: [{ tokenHash: sha256(reused.resumeToken) }, null] });
  });

  it('J2 jamais connecté avant la partie : seul J2 est libéré, puis un autre invité peut rejoindre', async () => {
    await setClock(server, T0);
    const { roomCode, resumeToken } = entry(await createWith('RELEASE2'));
    await connect(roomCode, resumeToken);
    await setClock(server, T0 + 1_000);
    const firstGuest = entry(await join(roomCode));
    const reserved = await state(roomCode);
    expect(reserved.seats[1]).toEqual({
      tokenHash: sha256(firstGuest.resumeToken),
      reservedUntil: T0 + 1_000 + RESERVATION_TTL_MS,
    });
    expect(await alarm(server, roomCode)).toBe(T0 + 1_000 + RESERVATION_TTL_MS);

    await setClock(server, T0 + 1_000 + RESERVATION_TTL_MS);
    // J2 libéré : reste l'inactivité (PFC-018), comptée depuis la première connexion de J1.
    expect(await alarm(server, roomCode, true)).toBe(T0 + IDLE_MS);

    expect(await state(roomCode)).toEqual({
      ...reserved,
      revision: reserved.revision + 1,
      ready: [false, false],
      connected: [true, false],
      seats: [reserved.seats[0], null],
    });
    const secondGuest = entry(await join(roomCode));
    expect(secondGuest.slot).toBe(1);
    expect((await state(roomCode)).seats[1]?.tokenHash).toBe(sha256(secondGuest.resumeToken));
  });

  it('un join arrivé à l’échéance exacte de J2 : l’échéance passe d’abord, le nouvel invité obtient J2', async () => {
    await setClock(server, T0);
    const { roomCode, resumeToken } = entry(await createWith('BUNDRY22'));
    await connect(roomCode, resumeToken);
    entry(await join(roomCode));

    await setClock(server, T0 + RESERVATION_TTL_MS - 1);
    expect((await join(roomCode)).body).toEqual(ROOM_FULL);

    await setClock(server, T0 + RESERVATION_TTL_MS);
    const late = entry(await join(roomCode));
    const room = await state(roomCode);
    expect(room.seats[1]).toEqual({
      tokenHash: sha256(late.resumeToken),
      reservedUntil: T0 + 2 * RESERVATION_TTL_MS,
    });
    expect(await alarm(server, roomCode)).toBe(T0 + 2 * RESERVATION_TTL_MS);
  });

  it('alarme réelle du runtime : une room dont J1 ne se connecte pas s’efface d’elle-même', async () => {
    // Création datée 29,5 s dans le passé : l'alarme réelle tombe ~0,5 s plus tard, sur l'heure réelle.
    await setClock(server, Date.now() - RESERVATION_TTL_MS + 500);
    const { roomCode } = entry(await createWith('REALALRM'));
    await setClock(server, null);
    expect(await readRoom(server, roomCode)).not.toBeNull();

    await expect.poll(() => tables(server, roomCode), { timeout: 10_000, interval: 100 }).toEqual([]);
    expect((await join(roomCode)).status).toBe(404);
  });
});

describe('PFC-012 — méthodes des routes d’entrée', () => {
  it.each([
    ['GET', '/api/rooms'],
    ['PUT', '/api/rooms'],
    ['DELETE', '/api/rooms'],
    ['GET', '/api/rooms/K7M2Q9XA/join'],
  ])('%s %s : 405 JSON avec Allow: POST, rien de créé', async (method, path) => {
    const response = await server.fetch(path, { method });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Méthode non autorisée pour cette ressource.' },
    });
  });

  it.each(['/api/rooms/', '/api/rooms/K7M2Q9XA', '/api/rooms/K7M2Q9XA/join/', '/api/rooms//join'])(
    'POST %s : route inconnue, 404 NOT_FOUND',
    async (path) => {
      const response = await server.fetch(path, { method: 'POST' });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Ressource introuvable.' } });
    },
  );
});
