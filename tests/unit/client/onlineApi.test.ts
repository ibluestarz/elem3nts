import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENTRY_TIMEOUT_MS, createRoom, joinRoom } from '../../../src/client/online/api.ts';
import { CODE, TOKEN, entryResponse, errorResponse } from './onlineFakes.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** `fetch` qui ne répond jamais mais rejette à l'annulation, comme le navigateur. */
function hangingFetch() {
  return vi.fn((_: string, init: RequestInit) => {
    const signal = init.signal;
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        reject(new DOMException('Abandon', 'AbortError'));
      });
    });
  });
}

describe('PFC-015 — entrée HTTP dans une room', () => {
  it('crée une room par un POST sans corps et valide la réponse', async () => {
    const fetch = vi.fn(() => Promise.resolve(entryResponse(0)));
    vi.stubGlobal('fetch', fetch);

    const result = await createRoom(new AbortController().signal);

    expect(result).toEqual({ ok: true, entry: { roomCode: CODE, slot: 0, resumeToken: TOKEN } });
    expect(fetch).toHaveBeenCalledWith('/api/rooms', expect.objectContaining({ method: 'POST' }));
    expect(fetch.mock.calls[0]).not.toContainEqual(expect.objectContaining({ body: expect.anything() as unknown }));
  });

  it('rejoint par le code canonique, encodé dans le chemin', async () => {
    const fetch = vi.fn(() => Promise.resolve(entryResponse(1)));
    vi.stubGlobal('fetch', fetch);

    const result = await joinRoom(CODE, new AbortController().signal);

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(`/api/rooms/${CODE}/join`, expect.anything());
  });

  it.each([
    [404, 'ROOM_UNAVAILABLE', 'ROOM_UNAVAILABLE'],
    [503, 'ROOM_UNAVAILABLE', 'ROOM_UNAVAILABLE'],
    [409, 'ROOM_FULL', 'ROOM_FULL'],
    [503, 'CODE_COLLISION', 'CODE_COLLISION'],
    [500, 'INTERNAL', 'server'],
    // PFC-020 : limite de débit par adresse, message dédié.
    [429, 'RATE_LIMITED', 'RATE_LIMITED'],
    [429, 'AUTRE', 'server'],
  ])('PFC-015-AC3 — %i %s → %s', async (status, code, failure) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(errorResponse(status, code))));
    expect(await joinRoom(CODE, new AbortController().signal)).toEqual({ ok: false, failure });
  });

  it('une réponse de succès mal formée est une erreur serveur, jamais une place', async () => {
    const body = new Response(JSON.stringify({ roomCode: CODE, slot: 0, resumeToken: 'court' }), { status: 201 });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(body)));
    expect(await createRoom(new AbortController().signal)).toEqual({ ok: false, failure: 'server' });

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>', { status: 502 }))));
    expect(await createRoom(new AbortController().signal)).toEqual({ ok: false, failure: 'server' });
  });

  it('PFC-015-AC3 — réseau coupé : échec réseau explicite', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    expect(await createRoom(new AbortController().signal)).toEqual({ ok: false, failure: 'network' });
  });

  it('une annulation n’est pas une erreur ; un délai dépassé est un échec réseau', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());

    const controller = new AbortController();
    const cancelled = createRoom(controller.signal);
    controller.abort();
    expect(await cancelled).toEqual({ ok: false, failure: 'aborted' });

    const slow = createRoom(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(ENTRY_TIMEOUT_MS);
    expect(await slow).toEqual({ ok: false, failure: 'network' });
  });
});
