import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ROOM_CODE_ALPHABET, isResumeToken, isRoomCode } from '../../src/shared/protocol/index.ts';
import { generateResumeToken, generateRoomCode, hashResumeToken } from '../../src/worker/tokens.ts';

/** Générateurs de la room (Web Crypto, identique dans workerd et Node) : forme, entropie et empreinte. */
describe('PFC-012 — codes de room et tokens de reprise', () => {
  it('l’alphabet compte 32 symboles non ambigus : un octet modulo 32 reste uniforme', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(32);
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[01IO]/);
  });

  it('un code a 8 caractères de l’alphabet ; 4 000 tirages sont distincts et couvrent tout l’alphabet', () => {
    const codes = Array.from({ length: 4_000 }, generateRoomCode);
    expect(codes.every(isRoomCode)).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);

    // 32 000 symboles, 1 000 attendus par symbole : un écart de ±20 % trahirait un biais (σ ≈ 31).
    const counts = new Map<string, number>();
    for (const symbol of codes.join('')) counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    expect(counts.size).toBe(32);
    for (const count of counts.values()) expect(Math.abs(count - 1_000)).toBeLessThan(200);
  });

  it('un token vaut 32 octets en base64url sans remplissage (43 caractères), tous distincts', () => {
    const tokens = Array.from({ length: 1_000 }, generateResumeToken);
    for (const token of tokens) {
      expect(token).toHaveLength(43);
      expect(isResumeToken(token)).toBe(true);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('l’empreinte est le SHA-256 hexadécimal du token, sans le token lui-même', async () => {
    const token = generateResumeToken();
    const hash = await hashResumeToken(token);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });
});
