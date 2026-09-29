import { describe, expect, it } from 'vitest';
import {
  AUTH_TIMEOUT_MS,
  MAX_CONSECUTIVE_VIOLATIONS,
  MESSAGES_PER_SECOND,
  MESSAGE_BURST,
  SOCKET_CLOSE_CODES,
  roomSocketPath,
} from '../../../src/shared/protocol/index.ts';

describe('PFC-013 — contrat de transport WebSocket partagé', () => {
  it('valeurs de PROTOCOL : authentification en 5 s, 20 trames/s, rafale 30, fermeture au 3e dépassement', () => {
    expect(AUTH_TIMEOUT_MS).toBe(5000);
    expect(MESSAGES_PER_SECOND).toBe(20);
    expect(MESSAGE_BURST).toBe(30);
    expect(MAX_CONSECUTIVE_VIOLATIONS).toBe(3);
  });

  it('codes de fermeture applicatifs distincts, dans la plage réservée aux applications (RFC 6455)', () => {
    const codes = Object.values(SOCKET_CLOSE_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toBeGreaterThanOrEqual(4000);
      expect(code).toBeLessThanOrEqual(4999);
    }
    expect(Object.isFrozen(SOCKET_CLOSE_CODES)).toBe(true);
  });

  it('chemin de socket : code seul, jamais de token dans l’URL', () => {
    expect(roomSocketPath('K7M2Q9XA')).toBe('/api/rooms/K7M2Q9XA/ws');
  });
});
