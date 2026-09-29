import type { TestHarness } from 'wrangler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lobbyRoom, matchEndedRoom, roundResultRoom, selectingRoom } from '../unit/protocol/rooms.ts';
import { ROOM_SCHEMA_VERSION } from '../../src/worker/codec.ts';
import { execSql, persisted, persistedV1, readRoom, rebuild, rows, startHarness, tables, writeRoom } from './support.ts';

let server: TestHarness;

beforeAll(async () => {
  server = await startHarness();
});

afterAll(async () => {
  await server.close();
});

/** États réels de room (moteur partagé), dont les choix privés d'une sélection en cours. */
const STATES = {
  lobby: persisted(lobbyRoom()),
  selecting: persisted(selectingRoom(['fire', 'plant'])),
  paused: persisted(selectingRoom(['water', null], { phase: 'paused', resumePhase: 'selecting', revision: 7, connected: [true, false] })),
  'round-result': persisted(roundResultRoom(['water', 'water'])),
  'match-ended': persisted(matchEndedRoom(1)),
};

describe('PFC-011-S1 — Restauration', () => {
  it.each(Object.entries(STATES))('PFC-011-S1 — %s : même revision et même état après reconstruction', async (phase, state) => {
    const name = `restore-${phase}`;
    expect(await writeRoom(server, name, state)).toEqual({ ok: true, state });

    await rebuild(server, name);

    const restored = await readRoom(server, name);
    expect(restored).toEqual(state);
    expect(restored?.revision).toBe(state.revision);
    const [row, ...others] = await rows(server, name);
    expect(others).toHaveLength(0);
    expect(row?.schema_version).toBe(ROOM_SCHEMA_VERSION);
    expect(row?.revision).toBe(state.revision);
  });

  it('PFC-011-S1 — les révisions successives restent restaurées dans l’ordre', async () => {
    const name = 'restore-successive';
    const first = STATES.selecting;
    const second = { ...STATES['round-result'], revision: first.revision + 1 };
    expect((await writeRoom(server, name, first)).ok).toBe(true);
    await rebuild(server, name);
    expect(await writeRoom(server, name, second)).toEqual({ ok: true, state: second });
    await rebuild(server, name);
    expect(await readRoom(server, name)).toEqual(second);
  });

  it('une room jamais écrite est relue vide, sans rien allouer (PFC-012 : pas même la table)', async () => {
    const name = 'restore-empty';
    expect(await readRoom(server, name)).toBeNull();
    await rebuild(server, name);
    expect(await readRoom(server, name)).toBeNull();
    expect(await tables(server, name)).toEqual([]);
  });

  it('deux rooms ne partagent aucun état', async () => {
    const lobby = STATES.lobby;
    const ended = STATES['match-ended'];
    await writeRoom(server, 'isolation-a', lobby);
    await writeRoom(server, 'isolation-b', ended);
    await rebuild(server, 'isolation-a');
    await rebuild(server, 'isolation-b');
    expect(await readRoom(server, 'isolation-a')).toEqual(lobby);
    expect(await readRoom(server, 'isolation-b')).toEqual(ended);
  });
});

describe('PFC-011-AC2 — écritures refusées sans effet', () => {
  it('une révision non croissante est refusée et ne remplace rien', async () => {
    const name = 'conflict-stale';
    const state = STATES.selecting;
    await writeRoom(server, name, state);
    expect(await writeRoom(server, name, { ...STATES.lobby, revision: state.revision })).toEqual({
      ok: false,
      code: 'REVISION_CONFLICT',
    });
    await rebuild(server, name);
    expect(await readRoom(server, name)).toEqual(state);
  });

  it('une écriture fondée sur une révision que le stockage a dépassée est refusée', async () => {
    const name = 'conflict-storage';
    const state = STATES.selecting;
    await writeRoom(server, name, state);
    // Le stockage a avancé sans que l'instance en mémoire le sache : la transaction relit le disque.
    await execSql(server, name, 'UPDATE room_state SET revision = ?', state.revision + 5);
    expect(await writeRoom(server, name, { ...state, revision: state.revision + 1 })).toEqual({
      ok: false,
      code: 'REVISION_CONFLICT',
    });
    const [row] = await rows(server, name);
    expect(row?.revision).toBe(state.revision + 5);
    expect(JSON.parse(String(row?.state))).toEqual(state);
  });

  it.each([
    ['token-hash', 'clé inconnue (hash de token)', { ...STATES.lobby, tokenHash: 'secret' }],
    ['score', 'score négatif', { ...STATES.selecting, match: { ...STATES.selecting.match, scores: [-1, 0] } }],
    ['phase', 'phase inconnue', { ...STATES.lobby, phase: 'waiting' }],
    ['pause', 'pause sans phase à reprendre', { ...STATES.selecting, phase: 'paused' }],
    ['element', 'élément inconnu', { ...STATES.selecting, selection: ['stone', null] }],
  ])('un état hors schéma (%s : %s) n’est jamais écrit', async (slug, _label, state) => {
    const name = `invalid-${slug}`;
    expect(await writeRoom(server, name, state)).toEqual({ ok: false, code: 'INVALID_STATE' });
    expect(await rows(server, name)).toEqual([]);
  });
});

describe('PFC-011-AC2 — schemaVersion et échec fermé', () => {
  const cases: readonly [string, string, string, readonly unknown[]][] = [
    ['too-new', 'schéma plus récent (retour arrière)', `UPDATE room_state SET schema_version = ${String(ROOM_SCHEMA_VERSION + 1)}`, []],
    ['version-zero', 'schéma inconnu', 'UPDATE room_state SET schema_version = 0', []],
    ['json', 'JSON illisible', 'UPDATE room_state SET state = ?', ['{"revision":']],
    ['revision', 'révision de colonne incohérente', 'UPDATE room_state SET revision = revision + 1', []],
    ['shape', 'état hors schéma', 'UPDATE room_state SET state = ?', ['{"revision":5}']],
  ];

  it.each(cases)('%s — %s : room indisponible en JSON 503, sans donnée, ligne intacte', async (slug, _label, query, bindings) => {
    const name = `fail-closed-${slug}`;
    await writeRoom(server, name, STATES.selecting);
    await execSql(server, name, query, ...bindings);
    const [before] = await rows(server, name);

    await rebuild(server, name);
    const response = await server.fetch(`/__harness/rooms/${name}/fetch`);

    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      error: { code: 'ROOM_UNAVAILABLE', message: 'Cette partie n’existe pas ou n’est plus disponible.' },
    });
    expect(body).not.toMatch(/fire|plant|water|K7M2Q9XA|match-42/);
    expect(await rows(server, name)).toEqual([before]);
  });

  it('sans upgrade WebSocket (PFC-013), une room lisible ne sert aucune route : JSON 404', async () => {
    const name = 'healthy-fetch';
    await writeRoom(server, name, STATES.lobby);
    const response = await server.fetch(`/__harness/rooms/${name}/fetch`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Ressource introuvable.' } });
  });
});

describe('PFC-012 — migration du schéma v1 vers le schéma courant', () => {
  const v1 = persistedV1(lobbyRoom());

  async function seedV1(name: string): Promise<void> {
    // Ligne telle que l'écrivait PFC-011 (schema_version 1, vue seule, joueurs marqués présents).
    await writeRoom(server, name, STATES.lobby);
    await execSql(server, name, 'UPDATE room_state SET schema_version = 1, state = ?', JSON.stringify(v1));
    await rebuild(server, name);
  }

  it('une room v1 est relue en v2 : places vides, personne présent ni prêt, création inconnue', async () => {
    const name = 'migrate-v1';
    await seedV1(name);

    expect(await readRoom(server, name)).toEqual({
      ...v1,
      ready: [false, false],
      connected: [false, false],
      createdAt: 0,
      seats: [null, null],
      settledMatchId: null,
      replies: [[], []],
      reconnectDeadline: null,
      resumeRemainingMs: null,
      lastActivityAt: 0,
    });
    // La lecture migre en mémoire sans réécrire : la ligne reste v1 jusqu'à la prochaine transition.
    const [row] = await rows(server, name);
    expect(row?.schema_version).toBe(1);
    expect(JSON.parse(String(row?.state))).toEqual(v1);
  });

  it('la transition suivante réécrit la room en v2, relue identique après reconstruction', async () => {
    const name = 'migrate-v1-commit';
    await seedV1(name);
    const migrated = await readRoom(server, name);
    const next = { ...migrated, revision: v1.revision + 1 };

    expect(await writeRoom(server, name, next)).toEqual({ ok: true, state: next });
    await rebuild(server, name);

    expect(await readRoom(server, name)).toEqual(next);
    const [row] = await rows(server, name);
    expect(row?.schema_version).toBe(ROOM_SCHEMA_VERSION);
  });

  it('une room v1 migrée ne peut pas être rejointe : création inconnue (0), fermée par sa durée maximale et effacée', async () => {
    const name = v1.roomCode;
    await seedV1(name);
    const response = await server.fetch(`/api/rooms/${name}/join`, { method: 'POST' });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'ROOM_UNAVAILABLE', message: 'Cette partie n’existe pas ou n’est plus disponible.' },
    });
    // PFC-018 : `createdAt = 0` dépasse la durée maximale de 4 h ; la room est effacée avant la demande.
    expect(await readRoom(server, name)).toBeNull();
    expect(await tables(server, name)).toEqual([]);
  });
});

describe('PFC-012 — invariants des places persistées', () => {
  const lobby = STATES.lobby;
  const [host, guest] = lobby.seats;
  const waitingHost = { tokenHash: host?.tokenHash ?? '', reservedUntil: 1_700_000_030_000 };

  it.each([
    ['sans-places', 'clé seats absente', { ...lobby, seats: undefined }],
    ['sans-creation', 'createdAt négatif', { ...lobby, createdAt: -1 }],
    ['token-clair', 'token en clair à la place du hash', { ...lobby, seats: [{ tokenHash: 'Zml4dHVyZS10b2tlbi1ub3QtYS1zZWNyZXQtMDAwMzI', reservedUntil: null }, guest] }],
    ['hash-majuscule', 'hash non canonique', { ...lobby, seats: [{ tokenHash: host?.tokenHash.toUpperCase(), reservedUntil: null }, guest] }],
    ['cle-en-trop', 'clé inconnue dans une place', { ...lobby, seats: [{ ...host, token: 'x' }, guest] }],
    ['invite-seul', 'J2 sans J1', { ...lobby, connected: [false, true], seats: [null, guest] }],
    ['meme-hash', 'deux places avec le même hash', { ...lobby, seats: [host, host] }],
    ['present-sans-place', 'J2 présent sans place', { ...lobby, seats: [host, null] }],
    ['present-en-attente', 'J1 présent mais réservation en attente', { ...lobby, seats: [waitingHost, guest] }],
    [
      'attente-en-partie',
      'réservation jamais connectée pendant une partie',
      { ...STATES.selecting, connected: [false, true], seats: [waitingHost, guest] },
    ],
  ])('un état incohérent (%s : %s) n’est jamais écrit', async (slug, _label, state) => {
    const name = `seats-${slug}`;
    expect(await writeRoom(server, name, state)).toEqual({ ok: false, code: 'INVALID_STATE' });
    expect(await tables(server, name)).toEqual([]);
  });

  it('une réservation en attente au lobby, avant toute partie, est un état valide', async () => {
    const state = { ...lobby, connected: [false, false], seats: [waitingHost, null] };
    expect(await writeRoom(server, 'seats-valid-waiting', state)).toEqual({ ok: true, state });
  });
});

describe('PFC-014 — schéma v3 : partie réglée et réponses mémorisées', () => {
  const current = STATES.lobby;
  const v2 = Object.fromEntries(
    Object.entries(current).filter(
      ([key]) => !['settledMatchId', 'replies', 'reconnectDeadline', 'resumeRemainingMs', 'lastActivityAt'].includes(key),
    ),
  );

  it('une room v2 est relue en v3 : aucune partie réglée, aucune réponse mémorisée ; la ligne reste v2 jusqu’à la transition suivante', async () => {
    const name = 'migrate-v2';
    await writeRoom(server, name, current);
    await execSql(server, name, 'UPDATE room_state SET schema_version = 2, state = ?', JSON.stringify(v2));
    await rebuild(server, name);

    expect(await readRoom(server, name)).toEqual({
      ...v2,
      settledMatchId: null,
      replies: [[], []],
      reconnectDeadline: null,
      resumeRemainingMs: null,
      lastActivityAt: current.createdAt,
    });
    const [row] = await rows(server, name);
    expect(row?.schema_version).toBe(2);
  });

  const replies = (count: number) => Array.from({ length: count }, (_, index) => ({ requestId: `r-${String(index)}`, revision: 1 }));
  const ended = STATES['match-ended'];
  const selecting = STATES.selecting;

  it.each([
    ['fin-non-reglee', 'fin de partie sans trophée réglé', { ...ended, settledMatchId: null }],
    ['fin-avec-echeance', 'fin de partie avec échéance', { ...ended, deadline: 1 }],
    ['partie-en-cours-reglee', 'partie en cours déjà réglée', { ...selecting, settledMatchId: selecting.match?.id ?? null }],
    ['selection-sans-echeance', 'sélection sans échéance', { ...selecting, deadline: null }],
    ['ouverture-sans-partie', 'ouverture sans partie', { ...STATES.lobby, phase: 'starting', roundId: 1, deadline: 1 }],
    ['resultat-autre-manche', 'résultat d’une autre manche', { ...STATES['round-result'], roundId: 2 }],
    ['reponses-en-trop', 'plus de 128 réponses pour une place', { ...current, replies: [replies(129), []] }],
    ['reponse-en-double', 'même requestId deux fois', { ...current, replies: [[...replies(1), ...replies(1)], []] }],
    ['reponse-future', 'réponse d’une révision future', { ...current, replies: [[], [{ requestId: 'r', revision: current.revision + 1 }]] }],
    ['reponse-invalide', 'requestId hors format', { ...current, replies: [[{ requestId: 'a b', revision: 1 }], []] }],
  ])('un état incohérent (%s : %s) n’est jamais écrit', async (slug, _label, state) => {
    const name = `game-${slug}`;
    expect(await writeRoom(server, name, state)).toEqual({ ok: false, code: 'INVALID_STATE' });
    expect(await tables(server, name)).toEqual([]);
  });

  it('128 réponses par place sont un état valide', async () => {
    const state = { ...current, replies: [replies(128), replies(128)] };
    expect(await writeRoom(server, 'game-replies-max', state)).toEqual({ ok: true, state });
  });
});

describe('PFC-017 — schéma v4 : absence, pause et reprise', () => {
  /** État v3 (PFC-014) : l'état courant sans les champs de reprise (v4) ni d'activité (v5). */
  const v3 = (state: object) =>
    Object.fromEntries(
      Object.entries(state).filter(([key]) => !['reconnectDeadline', 'resumeRemainingMs', 'lastActivityAt'].includes(key)),
    );

  async function seedV3(name: string, state: object): Promise<void> {
    await writeRoom(server, name, STATES.lobby);
    await execSql(server, name, 'UPDATE room_state SET schema_version = 3, revision = ?, state = ?', (state as { revision: number }).revision, JSON.stringify(v3(state)));
    await rebuild(server, name);
  }

  it('une room v3 où tous sont présents est relue en v4 sans échéance ; la ligne reste v3', async () => {
    const name = 'migrate-v3';
    await seedV3(name, STATES.selecting);
    expect(await readRoom(server, name)).toEqual({
      ...v3(STATES.selecting),
      reconnectDeadline: null,
      resumeRemainingMs: null,
      lastActivityAt: STATES.selecting.createdAt,
    });
    expect((await rows(server, name))[0]?.schema_version).toBe(3);
  });

  it('une room v3 avec une place partie reçoit un délai déjà échu : fermée au premier traitement, jamais continuée', async () => {
    const name = 'migrate-v3-absent';
    const absent = persisted(lobbyRoom({ connected: [true, false] }));
    await seedV3(name, absent);
    expect(await readRoom(server, name)).toMatchObject({ connected: [true, false], reconnectDeadline: 0, resumeRemainingMs: null });
  });

  it('une room v3 en pause (jamais produite) reste hors schéma : échec fermé en 503', async () => {
    const name = 'migrate-v3-paused';
    await seedV3(name, STATES.paused);
    expect((await server.fetch(`/__harness/rooms/${name}/fetch`)).status).toBe(503);
  });

  it('une pause valide : phase à reprendre, temps restant, échéance publiée = reconnexion, une place absente', async () => {
    expect((await writeRoom(server, 'pause-valid', STATES.paused)).ok).toBe(true);
    const starting = persisted(selectingRoom([null, null], { phase: 'paused', resumePhase: 'starting', connected: [false, false] }));
    expect((await writeRoom(server, 'pause-starting', starting)).ok).toBe(true);
  });

  const paused = STATES.paused;
  it.each([
    ['pause-sans-reste', 'pause sans temps restant', { ...paused, resumeRemainingMs: null }],
    ['pause-reste-nul', 'temps restant nul', { ...paused, resumeRemainingMs: 0 }],
    ['pause-reste-demesure', 'temps restant au-delà d’une phase', { ...paused, resumeRemainingMs: 60_001 }],
    ['pause-sans-absent', 'pause alors que tous sont présents', { ...paused, connected: [true, true] }],
    ['pause-echeance-autre', 'échéance publiée différente de la reconnexion', { ...paused, deadline: (paused.deadline ?? 0) + 1 }],
    ['pause-sans-partie', 'pause sans partie', { ...paused, match: null }],
    ['reste-hors-pause', 'temps restant hors pause', { ...STATES.selecting, resumeRemainingMs: 1000 }],
    ['absent-sans-delai', 'place absente sans délai de reconnexion', { ...STATES.lobby, connected: [true, false] }],
    ['delai-sans-absent', 'délai de reconnexion sans absent', { ...STATES.lobby, reconnectDeadline: 1 }],
    ['ferme-avec-delai', 'room fermée avec un délai', { ...STATES.lobby, phase: 'closed', reconnectDeadline: 1 }],
  ])('un état incohérent (%s : %s) n’est jamais écrit', async (slug, _label, state) => {
    const name = `absence-${slug}`;
    expect(await writeRoom(server, name, state)).toEqual({ ok: false, code: 'INVALID_STATE' });
    expect(await tables(server, name)).toEqual([]);
  });
});

describe('PFC-018 — schéma v5 : dernière activité utile', () => {
  /** État v4 (PFC-017) : l'état courant sans la dernière activité. */
  const v4 = (state: object) => Object.fromEntries(Object.entries(state).filter(([key]) => key !== 'lastActivityAt'));

  async function seedV4(name: string, state: object): Promise<void> {
    await writeRoom(server, name, STATES.lobby);
    await execSql(server, name, 'UPDATE room_state SET schema_version = 4, revision = ?, state = ?', (state as { revision: number }).revision, JSON.stringify(v4(state)));
    await rebuild(server, name);
  }

  it('une room v4 est relue en v5 avec sa création pour dernière activité (rien d’inventé) ; la ligne reste v4', async () => {
    const name = 'migrate-v4';
    await seedV4(name, STATES['match-ended']);
    expect(await readRoom(server, name)).toEqual({ ...v4(STATES['match-ended']), lastActivityAt: STATES['match-ended'].createdAt });
    expect((await rows(server, name))[0]?.schema_version).toBe(4);
  });

  it('une activité postérieure à la création est un état valide', async () => {
    const state = { ...STATES.selecting, lastActivityAt: STATES.selecting.createdAt + 60_000 };
    expect(await writeRoom(server, 'activity-valid', state)).toEqual({ ok: true, state });
  });

  const lobby = STATES.lobby;
  it.each([
    ['activite-absente', 'dernière activité absente', v4(lobby)],
    ['activite-nulle', 'dernière activité nulle', { ...lobby, lastActivityAt: null }],
    ['activite-negative', 'dernière activité négative', { ...lobby, createdAt: 0, lastActivityAt: -1 }],
    ['activite-decimale', 'dernière activité non entière', { ...lobby, lastActivityAt: lobby.createdAt + 0.5 }],
    ['activite-avant-creation', 'activité antérieure à la création', { ...lobby, lastActivityAt: lobby.createdAt - 1 }],
  ])('un état incohérent (%s : %s) n’est jamais écrit', async (slug, _label, state) => {
    const name = `activity-${slug}`;
    expect(await writeRoom(server, name, state)).toEqual({ ok: false, code: 'INVALID_STATE' });
    expect(await tables(server, name)).toEqual([]);
  });
});
