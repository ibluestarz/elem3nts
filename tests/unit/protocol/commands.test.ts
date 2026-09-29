import { describe, expect, it } from 'vitest';
import {
  COMMAND_TYPES,
  MAX_MESSAGE_BYTES,
  authorizeCommand,
  parseClientMessage,
  projectState,
  type ClientCommand,
  type CommandType,
  type ParseResult,
} from '../../../src/shared/protocol/index.ts';
import { MATCH_ID, RESUME_TOKEN, selectingRoom } from './rooms.ts';

type Json = Record<string, unknown>;

/** Un message valide de chaque commande, tel qu'un client v1 l'envoie. */
const VALID: Readonly<Record<CommandType, Json>> = {
  authenticate: { v: 1, type: 'authenticate', requestId: 'auth-1', payload: { resumeToken: RESUME_TOKEN } },
  'update-settings': {
    v: 1,
    type: 'update-settings',
    requestId: 'set-1',
    payload: { expectedSettingsRevision: 0, settings: { target: 5, drawEnabled: false } },
  },
  ready: { v: 1, type: 'ready', requestId: 'ready-1', payload: { expectedSettingsRevision: 0 } },
  'submit-choice': {
    v: 1,
    type: 'submit-choice',
    requestId: 'identifiant-unique-client',
    matchId: MATCH_ID,
    roundId: 2,
    payload: { element: 'fire' },
  },
  'rematch-ready': {
    v: 1,
    type: 'rematch-ready',
    requestId: 'again-1',
    matchId: MATCH_ID,
    payload: { expectedSettingsRevision: 4 },
  },
  leave: { v: 1, type: 'leave', requestId: 'bye', payload: {} },
  ping: { v: 1, type: 'ping', requestId: 'p-1', payload: {} },
};

function parse(message: unknown): ParseResult {
  return parseClientMessage(JSON.stringify(message));
}

function withPayload(type: CommandType, payload: Json): Json {
  return { ...VALID[type], payload: { ...(VALID[type]['payload'] as Json), ...payload } };
}

function without(message: Json, key: string): Json {
  return Object.fromEntries(Object.entries(message).filter(([name]) => name !== key));
}

function expectRejected(result: ParseResult, code = 'INVALID_MESSAGE'): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe(code);
}

describe('PFC-010 — validation des commandes client', () => {
  it('PFC-010-S2 — submit-choice avec element=stone : INVALID_MESSAGE sans modifier l’état', () => {
    const room = selectingRoom(['water', null]);
    const before = structuredClone(room);
    const result = parse(withPayload('submit-choice', { element: 'stone' }));

    expect(result).toEqual({
      ok: false,
      code: 'INVALID_MESSAGE',
      reason: 'bad-payload',
      requestId: 'identifiant-unique-client',
    });
    // Rejet au schéma : la commande n'atteint jamais la politique ni la room.
    expect(room).toEqual(before);
    expect(projectState(room, 1, 0)).toEqual(projectState(before, 1, 0));
  });

  it('PFC-010-AC1 — accepte chaque commande du protocole et la reconstruit à l’identique', () => {
    expect(Object.keys(VALID).sort()).toEqual([...COMMAND_TYPES].sort());
    for (const message of Object.values(VALID)) {
      expect(parse(message)).toEqual({ ok: true, command: message });
    }
    expect(parse(withPayload('submit-choice', { element: 'water' })).ok).toBe(true);
    expect(parse(withPayload('submit-choice', { element: 'plant' })).ok).toBe(true);
  });

  it('PFC-010-AC3 — mauvais type de trame, JSON invalide ou non objet', () => {
    const notText: readonly unknown[] = [undefined, null, 42, {}, new ArrayBuffer(8), new Uint8Array([123, 125])];
    for (const raw of notText) expect(parseClientMessage(raw)).toMatchObject({ ok: false, reason: 'not-text' });
    for (const raw of ['', '{', 'undefined', "{'v':1}", '{"v":1,}']) {
      expect(parseClientMessage(raw)).toMatchObject({ ok: false, code: 'INVALID_MESSAGE', reason: 'not-json' });
    }
    for (const raw of ['null', '1', '"ping"', 'true', '[]', JSON.stringify([VALID.ping])]) {
      expect(parseClientMessage(raw)).toMatchObject({ ok: false, code: 'INVALID_MESSAGE', reason: 'not-object' });
    }
  });

  it('PFC-010-AC3 — taille : 4 096 octets UTF-8 acceptés, un de plus refusé, multi-octets compris', () => {
    const base = JSON.stringify(VALID.ping);
    const exact = base.replace('"p-1"', `"p-1","_":"${'a'.repeat(MAX_MESSAGE_BYTES - base.length - 7)}"`);
    expect(new TextEncoder().encode(exact).length).toBe(MAX_MESSAGE_BYTES);
    // Exactement à la limite : la taille passe, seul le champ inconnu « _ » est refusé ensuite.
    expect(parseClientMessage(exact)).toMatchObject({ reason: 'bad-envelope' });
    expect(parseClientMessage(`${exact} `)).toMatchObject({ code: 'INVALID_MESSAGE', reason: 'too-large' });

    // « é » : 1 unité UTF-16 mais 2 octets ; « 🔥 » : 2 unités, 4 octets. La limite porte sur les octets.
    const accented = base.replace('"p-1"', `"p-1","_":"${'é'.repeat(3000)}"`);
    expect(accented.length).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(new TextEncoder().encode(accented).length).toBeGreaterThan(MAX_MESSAGE_BYTES);
    expect(parseClientMessage(accented)).toMatchObject({ reason: 'too-large' });
    const emoji = base.replace('"p-1"', `"p-1","_":"${'🔥'.repeat(1100)}"`);
    expect(emoji.length).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(parseClientMessage(emoji)).toMatchObject({ reason: 'too-large' });
    expect(parseClientMessage('x'.repeat(10 * MAX_MESSAGE_BYTES))).toMatchObject({ reason: 'too-large' });
  });

  it('PFC-010-AC3 — version : absente ou non entière INVALID_MESSAGE, autre entier VERSION_UNSUPPORTED', () => {
    for (const v of [0, 2, -1, 999]) {
      expect(parse({ ...VALID.ping, v })).toEqual({
        ok: false,
        code: 'VERSION_UNSUPPORTED',
        reason: 'bad-version',
        requestId: 'p-1',
      });
    }
    for (const v of ['1', 1.5, null, true, [1]]) expectRejected(parse({ ...VALID.ping, v }));
    expectRejected(parse(without(VALID.ping, 'v')));
  });

  it('PFC-010-AC3 — type inconnu ou mal formé', () => {
    for (const type of ['join', 'state', 'ack', 'SUBMIT-CHOICE', 'submit_choice', '', 1, null]) {
      expect(parse({ ...VALID.ping, type })).toMatchObject({ ok: false, code: 'INVALID_MESSAGE', reason: 'unknown-type' });
    }
    expectRejected(parse(without(VALID.ping, 'type')));
  });

  it('PFC-010-AC3 — élément : seuls fire, water, plant', () => {
    for (const element of ['stone', 'Fire', 'FIRE', ' fire', '', null, 0, ['fire'], { fire: true }]) {
      expect(parse(withPayload('submit-choice', { element }))).toMatchObject({ ok: false, reason: 'bad-payload' });
    }
  });

  it('PFC-010-AC3 — identifiants : requestId, matchId, roundId et token bornés', () => {
    const badIds: readonly unknown[] = ['', 'a'.repeat(65), 'with space', 'é', 'a/b', '<script>', 7, null];
    for (const requestId of badIds) {
      expect(parse({ ...VALID.ping, requestId })).toEqual({ ok: false, code: 'INVALID_MESSAGE', reason: 'bad-envelope' });
    }
    expect(parse({ ...VALID.ping, requestId: 'a'.repeat(64) }).ok).toBe(true);
    for (const matchId of badIds) {
      expect(parse({ ...VALID['submit-choice'], matchId })).toMatchObject({ ok: false, reason: 'bad-envelope' });
      expect(parse({ ...VALID['rematch-ready'], matchId })).toMatchObject({ ok: false, reason: 'bad-envelope' });
    }
    for (const roundId of [0, -1, 1.5, '2', null, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parse({ ...VALID['submit-choice'], roundId })).toMatchObject({ ok: false, reason: 'bad-envelope' });
    }
    const infinite = JSON.stringify(VALID['submit-choice']).replace('"roundId":2', '"roundId":1e400');
    expect(parseClientMessage(infinite)).toMatchObject({ ok: false, reason: 'bad-envelope' });
    expect(parse({ ...VALID['submit-choice'], roundId: Number.MAX_SAFE_INTEGER }).ok).toBe(true);
    for (const resumeToken of [RESUME_TOKEN.slice(1), `${RESUME_TOKEN}A`, `${RESUME_TOKEN.slice(0, 42)}B`, `${RESUME_TOKEN.slice(0, 42)}=`, 42]) {
      expect(parse(withPayload('authenticate', { resumeToken }))).toMatchObject({ ok: false, reason: 'bad-payload' });
    }
  });

  it('PFC-010-AC3 — bornes des révisions attendues', () => {
    for (const type of ['ready', 'rematch-ready', 'update-settings'] as const) {
      for (const expectedSettingsRevision of [-1, 0.5, '0', null, Number.MAX_SAFE_INTEGER + 1]) {
        expect(parse(withPayload(type, { expectedSettingsRevision }))).toMatchObject({ ok: false, reason: 'bad-payload' });
      }
      expect(parse(withPayload(type, { expectedSettingsRevision: Number.MAX_SAFE_INTEGER })).ok).toBe(true);
    }
  });

  it('PFC-010-AC3 — réglages : forme stricte INVALID_MESSAGE, X hors 1–10 ou non entier INVALID_SETTINGS', () => {
    const settings = (value: unknown) => parse(withPayload('update-settings', { settings: value }));

    for (const target of [0, 11, -3, 3.5, 1e308]) {
      expect(settings({ target, drawEnabled: true })).toEqual({
        ok: false,
        code: 'INVALID_SETTINGS',
        reason: 'bad-settings',
        requestId: 'set-1',
      });
    }
    for (const value of [
      { target: '3', drawEnabled: true },
      { target: 3, drawEnabled: 'true' },
      { target: 3 },
      { target: 3, drawEnabled: true, rounds: 9 },
      [3, true],
      null,
    ]) {
      expect(settings(value)).toMatchObject({ ok: false, code: 'INVALID_MESSAGE', reason: 'bad-payload' });
    }
    // 1e400 n'existe qu'en texte : JSON.parse le lit Infinity, jamais un entier.
    const infinite = JSON.stringify(withPayload('update-settings', { settings: { target: 3, drawEnabled: true } }));
    expect(parseClientMessage(infinite.replace('"target":3', '"target":1e400'))).toMatchObject({
      code: 'INVALID_SETTINGS',
    });
    expect(settings({ target: 1, drawEnabled: true }).ok).toBe(true);
    expect(settings({ target: 10, drawEnabled: false }).ok).toBe(true);
  });

  it('PFC-010-AC3 — champs inconnus ou manquants refusés, dans l’enveloppe comme dans le payload', () => {
    for (const [type, message] of Object.entries(VALID) as [CommandType, Json][]) {
      expect(parse({ ...message, playerId: 0 })).toMatchObject({ ok: false, reason: 'bad-envelope' });
      expect(parse({ ...message, slot: 1 })).toMatchObject({ ok: false, reason: 'bad-envelope' });
      expect(parse(withPayload(type, { extra: true }))).toMatchObject({ ok: false, reason: 'bad-payload' });
      for (const key of Object.keys(message).filter((name) => name !== 'v' && name !== 'type')) {
        expectRejected(parse(without(message, key)));
      }
      for (const payload of [null, [], 'x', 1]) expectRejected(parse({ ...message, payload }));
    }
    // Le contexte de partie n'est admis que là où le protocole le demande.
    expect(parse({ ...VALID.ready, matchId: MATCH_ID })).toMatchObject({ ok: false, reason: 'bad-envelope' });
    expect(parse({ ...VALID['rematch-ready'], roundId: 1 })).toMatchObject({ ok: false, reason: 'bad-envelope' });
  });

  it('PFC-010-AC3 — __proto__ et constructor sont des champs inconnus, sans pollution de prototype', () => {
    const polluted = JSON.stringify(VALID.ping).replace('"payload":{}', '"payload":{"__proto__":{"admin":true}}');
    expect(parseClientMessage(polluted)).toMatchObject({ ok: false, reason: 'bad-payload' });
    const envelope = JSON.stringify(VALID.ping).replace('{"v":1', '{"__proto__":{"slot":0},"v":1');
    expect(parseClientMessage(envelope)).toMatchObject({ ok: false, reason: 'bad-envelope' });
    expect(parse({ ...VALID.ping, constructor: 'x' })).toMatchObject({ ok: false, reason: 'bad-envelope' });
    expect(({} as Json)['admin']).toBeUndefined();
  });

  it('PFC-010-AC2 — un refus ne recopie ni token, ni élément, ni texte reçu', () => {
    const attempts = [
      withPayload('authenticate', { resumeToken: `${RESUME_TOKEN}A` }),
      { ...VALID.authenticate, extra: RESUME_TOKEN },
      withPayload('submit-choice', { element: 'fire', extra: 1 }),
      { ...VALID['submit-choice'], requestId: 'fire water plant' },
    ];
    for (const attempt of attempts) {
      const result = parse(attempt);
      expect(result.ok).toBe(false);
      const text = JSON.stringify(result);
      expect(text).not.toContain(RESUME_TOKEN.slice(0, 20));
      expect(text).not.toMatch(/fire|water|plant|extra/);
    }
  });

  it('renvoie une commande neuve et gelée, sans champ ni référence venant de l’entrée', () => {
    const result = parse(VALID['update-settings']);
    if (!result.ok) throw new Error('commande valide refusée');
    const { command } = result;
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(command.payload)).toBe(true);
    if (command.type === 'update-settings') expect(Object.isFrozen(command.payload.settings)).toBe(true);
  });

  it('ne lève jamais, même sur 5 000 trames aléatoires dérivées de messages valides', () => {
    let seed = 20_260_928;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const samples: readonly unknown[] = [null, 0, -1, 1.5, '', 'fire', true, [], {}, [1, 2], { v: 1 }, 'x'.repeat(70)];
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

    for (let index = 0; index < 5_000; index += 1) {
      const message: Json = structuredClone(pick(Object.values(VALID)));
      const target = random() < 0.5 ? message : (message['payload'] as Json);
      const key = random() < 0.7 ? pick(Object.keys(target)) : pick(['extra', 'playerId', '__proto__']);
      if (random() < 0.2) Reflect.deleteProperty(target, key);
      else target[key] = pick(samples);

      const result = parse(message);
      if (result.ok) {
        // Une mutation acceptée reste un message valide, qui se relit à l'identique.
        expect(parseClientMessage(JSON.stringify(result.command))).toEqual(result);
      } else {
        expect(['INVALID_MESSAGE', 'INVALID_SETTINGS', 'VERSION_UNSUPPORTED']).toContain(result.code);
      }
    }
  });

  it('les commandes reconstruites alimentent la politique sans conversion', () => {
    const result = parse(VALID['submit-choice']);
    if (!result.ok) throw new Error('commande valide refusée');
    const command: ClientCommand = result.command;
    expect(authorizeCommand(command, selectingRoom([null, null]), 0)).toEqual({ ok: false, code: 'STALE_ROUND' });
    expect(authorizeCommand({ ...command, roundId: 1 } as ClientCommand, selectingRoom([null, null]), 0)).toEqual({
      ok: true,
    });
  });
});
