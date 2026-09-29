import { describe, expect, it } from 'vitest';
import {
  CLOSE_REASONS,
  ERROR_CODES,
  ERROR_MESSAGES,
  ROOM_CODE_ALPHABET,
  ackMessage,
  encodeServerMessage,
  errorMessage,
  isResumeToken,
  normalizeRoomCode,
  parseClientMessage,
  parseServerMessage,
  pongMessage,
  projectState,
  roomClosedMessage,
  utf8ByteLength,
} from '../../../src/shared/protocol/index.ts';
import { RESUME_TOKEN, roundResultRoom, selectingRoom } from './rooms.ts';

describe('PFC-010 — messages serveur', () => {
  it('PFC-010-AC2 — ack et erreurs ne portent que requestId, révision ou code : aucun choix ni token', () => {
    const ack = ackMessage('identifiant-unique-client', 7);
    expect(ack).toEqual({ v: 1, type: 'ack', requestId: 'identifiant-unique-client', revision: 7 });

    for (const code of ERROR_CODES) {
      const error = errorMessage(code, 'r-1');
      expect(error).toEqual({ v: 1, type: 'error', requestId: 'r-1', code, message: ERROR_MESSAGES[code] });
      expect(errorMessage(code)).not.toHaveProperty('requestId');
      expect(encodeServerMessage(error)).not.toMatch(/fire|water|plant|token|hash/i);
    }
  });

  it('PFC-010-AC2 — la chaîne complète d’un refus (parse → error) ne renvoie rien du message reçu', () => {
    const raw = JSON.stringify({
      v: 1,
      type: 'authenticate',
      requestId: 'auth-1',
      payload: { resumeToken: RESUME_TOKEN, element: 'fire' },
    });
    const result = parseClientMessage(raw);
    if (result.ok) throw new Error('message invalide accepté');
    const frame = encodeServerMessage(errorMessage(result.code, result.requestId));
    expect(frame).toBe(
      JSON.stringify({ v: 1, type: 'error', requestId: 'auth-1', code: 'INVALID_MESSAGE', message: ERROR_MESSAGES.INVALID_MESSAGE }),
    );
  });

  it('messages humains en français, fixes par code, sans trace technique', () => {
    for (const code of ERROR_CODES) {
      const message = ERROR_MESSAGES[code];
      expect(message).toMatch(/^[A-ZÀ-Ý]/);
      expect(message).not.toMatch(/Error|stack|undefined|\{|at /);
    }
    expect(new Set(Object.values(ERROR_MESSAGES)).size).toBe(ERROR_CODES.length);
  });

  it('chaque message construit se relit par le client à l’identique', () => {
    const messages = [
      ackMessage('a', 0),
      errorMessage('RATE_LIMITED'),
      errorMessage('STALE_ROUND', 'x_1'),
      pongMessage('p-1', 1_700_000_000_000),
      ...CLOSE_REASONS.map(roomClosedMessage),
      projectState(selectingRoom(), 1, 5),
      projectState(roundResultRoom(), 0, 5),
    ];
    for (const message of messages) {
      const parsed = parseServerMessage(encodeServerMessage(message));
      expect(parsed).toEqual({ ok: true, message });
      if (parsed.ok) expect(Object.isFrozen(parsed.message)).toBe(true);
    }
  });

  it('le client refuse une trame serveur mal formée, d’une autre version ou avec un champ inconnu', () => {
    const state = JSON.parse(encodeServerMessage(projectState(selectingRoom(), 0, 5))) as Record<string, unknown>;
    const invalid: readonly unknown[] = [
      42,
      'pas du json',
      '[]',
      JSON.stringify({ ...ackMessage('a', 1), v: 2 }),
      JSON.stringify({ ...ackMessage('a', 1), extra: 1 }),
      JSON.stringify({ ...ackMessage('a', -1) }),
      JSON.stringify({ ...errorMessage('INVALID_MESSAGE'), code: 'TEAPOT' }),
      JSON.stringify({ v: 1, type: 'room-closed', reason: 'crash' }),
      JSON.stringify({ v: 1, type: 'hello' }),
      JSON.stringify({ ...state, tokenHash: 'x' }),
      JSON.stringify({ ...state, scores: [-1, 0] }),
      JSON.stringify({ ...state, settings: { target: 11, drawEnabled: true } }),
      JSON.stringify({ ...state, roomCode: 'k7m2q9xa' }),
      JSON.stringify({ ...state, yourSlot: 2 }),
      // Défense en profondeur : choix publiés en sélection, ou résultat sans ses choix.
      JSON.stringify({ ...state, revealedChoices: ['fire', 'plant'], result: { kind: 'burn', winner: 0, delta: [1, 0] } }),
      JSON.stringify({ ...state, phase: 'round-result', result: { kind: 'burn', winner: 0, delta: [1, 0] } }),
      JSON.stringify({ ...state, phase: 'paused' }),
      // Seules l'ouverture, la sélection et le résultat se reprennent (PFC-017).
      JSON.stringify({ ...state, phase: 'paused', resumePhase: 'lobby' }),
      JSON.stringify({ ...state, phase: 'paused', resumePhase: 'match-ended' }),
      JSON.stringify({ ...state, resumePhase: 'starting' }),
      JSON.stringify({ ...state, matchResult: { status: 'draw' } }),
    ];
    for (const raw of invalid) expect(parseServerMessage(raw)).toEqual({ ok: false });
  });
});

describe('PFC-010-AC3 — identifiants de room et de reprise', () => {
  it('normalise le code saisi (trim + majuscules) et refuse les caractères ambigus', () => {
    expect(normalizeRoomCode('  k7m2q9xa ')).toBe('K7M2Q9XA');
    expect(normalizeRoomCode('K7M2Q9XA')).toBe('K7M2Q9XA');
    for (const raw of ['K7M2Q9X', 'K7M2Q9XAB', 'K7M2Q9X0', 'K7M2Q9XO', 'K7M2Q9X1', 'K7M2Q9XI', 'K7M2 Q9X', 'K7M2-Q9X', '']) {
      expect(normalizeRoomCode(raw)).toBeNull();
    }
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[01IO]/);
  });

  it('un resumeToken est exactement 256 bits en base64url canonique', () => {
    expect(isResumeToken(RESUME_TOKEN)).toBe(true);
    for (let index = 0; index < 64; index += 1) {
      const bytes = new Uint8Array(32).fill(index * 4);
      const token = Buffer.from(bytes).toString('base64url');
      expect(isResumeToken(token), token).toBe(true);
    }
    expect(isResumeToken(Buffer.from(new Uint8Array(31)).toString('base64url'))).toBe(false);
    expect(isResumeToken(Buffer.from(new Uint8Array(32)).toString('base64'))).toBe(false);
  });

  it('mesure la taille UTF-8 comme TextEncoder, surrogates isolés compris', () => {
    const encoder = new TextEncoder();
    for (const text of ['', 'abc', 'é', '€', '🔥', 'a🔥é€', '\ud83d', '\udd25x', 'x\ud83d']) {
      expect(utf8ByteLength(text), JSON.stringify(text)).toBe(encoder.encode(text).length);
    }
  });
});
