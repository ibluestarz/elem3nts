import { describe, expect, it } from 'vitest';
import { parseRoomEntry } from '../../../src/shared/protocol/index.ts';
import { RESUME_TOKEN, ROOM_CODE } from './rooms.ts';

const VALID = { roomCode: ROOM_CODE, slot: 1, resumeToken: RESUME_TOKEN };

describe('PFC-012 — réponse privée d’entrée dans une room', () => {
  it('accepte code canonique, place J1/J2 et token 256 bits, et rend une copie gelée', () => {
    for (const slot of [0, 1] as const) {
      const parsed = parseRoomEntry({ ...VALID, slot });
      expect(parsed).toEqual({ ...VALID, slot });
      expect(Object.isFrozen(parsed)).toBe(true);
    }
  });

  it.each([
    ['non objet', 'K7M2Q9XA'],
    ['null', null],
    ['tableau', [ROOM_CODE, 1, RESUME_TOKEN]],
    ['clé manquante', { roomCode: ROOM_CODE, slot: 1 }],
    ['clé en trop', { ...VALID, playerId: 'p2' }],
    ['code non canonique (minuscules)', { ...VALID, roomCode: ROOM_CODE.toLowerCase() }],
    ['code ambigu', { ...VALID, roomCode: 'K7M2Q9X0' }],
    ['troisième place', { ...VALID, slot: 2 }],
    ['place en texte', { ...VALID, slot: '1' }],
    ['token court', { ...VALID, resumeToken: RESUME_TOKEN.slice(1) }],
    ['token avec remplissage', { ...VALID, resumeToken: `${RESUME_TOKEN}=` }],
  ])('refuse une réponse hors contrat (%s)', (_label, value) => {
    expect(parseRoomEntry(value)).toBeNull();
  });
});
