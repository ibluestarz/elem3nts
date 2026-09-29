import type { TestHarness } from 'wrangler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness } from './support.ts';

let server: TestHarness;

beforeAll(async () => {
  server = await startHarness();
});

afterAll(async () => {
  await server.close();
});

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Ressource introuvable.' } };

describe('PFC-011-S2 — Route API absente', () => {
  it.each([
    ['GET', '/api/inconnue'],
    ['POST', '/api/inconnue'],
    ['DELETE', '/api/inconnue'],
    ['GET', '/api'],
    ['GET', '/api/'],
    ['GET', '/api/rooms/K7M2Q9XA/inconnue'],
    ['GET', '/api/inconnue?code=%3Cscript%3E'],
  ])('PFC-011-S2 — %s %s : erreur JSON 404, jamais la page React', async (method, path) => {
    const response = await server.fetch(path, {
      method,
      ...(method === 'POST' ? { body: '{"attaque":"<script>"}', headers: { 'content-type': 'application/json' } } : {}),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const body = await response.text();
    expect(JSON.parse(body)).toEqual(NOT_FOUND);
    expect(body).not.toMatch(/<!doctype|<html|script/i);
  });

  it('garde défensive : une requête hors API transmise au Worker reçoit aussi un 404 JSON', async () => {
    const response = await server.fetch('/assets/absent.js');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(NOT_FOUND);
  });
});
