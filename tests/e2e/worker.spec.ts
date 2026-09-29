import { expect, test, type Page } from '@playwright/test';
import { parseRoomEntry } from '../../src/shared/protocol/index.ts';
import { isolatedContext, stubScene, trackProblems } from './support.ts';

/**
 * Worker local réel (PFC-011) : `vite preview` exécute le Worker construit dans workerd, avec les
 * fichiers statiques du build. API et SPA partagent la même origine que la page.
 */
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Ressource introuvable.' } };

test.describe('PFC-011 — Worker local et stockage Durable Object', () => {
  test('PFC-011-S2 / AC1 — /api/inconnue : erreur JSON 404 du Worker, jamais la page React', async ({ page }) => {
    await stubScene(page);
    // Navigation réelle (Sec-Fetch-Mode: navigate) : c'est elle qui déclencherait le repli SPA.
    const response = await page.goto('/api/inconnue');

    expect(response?.status()).toBe(404);
    expect(response?.headers()['content-type']).toBe('application/json; charset=utf-8');
    expect(response?.headers()['cache-control']).toBe('no-store');
    expect(await response?.json()).toEqual(NOT_FOUND);
    await expect(page.getByRole('main', { name: 'ELEM3NTS' })).toHaveCount(0);
  });

  test('PFC-011-AC1 — la page appelle l’API sur sa propre origine', async ({ page }) => {
    await stubScene(page);
    await page.goto('/');
    await expect(page.getByRole('main', { name: 'ELEM3NTS' })).toBeAttached();

    const result = await page.evaluate(async () => {
      const response = await fetch('/api/inconnue', { method: 'POST', body: '{}' });
      return {
        sameOrigin: new URL(response.url).origin === location.origin,
        status: response.status,
        type: response.headers.get('content-type'),
        body: (await response.json()) as unknown,
      };
    });
    expect(result).toEqual({
      sameOrigin: true,
      status: 404,
      type: 'application/json; charset=utf-8',
      body: NOT_FOUND,
    });
  });

  test('PFC-011-AC1 — un chemin front rechargé sert la SPA sans erreur', async ({ page }) => {
    await stubScene(page);
    const problems = trackProblems(page);

    const first = await page.goto('/salle/K7M2Q9XA');
    expect(first?.status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Jouer en local' })).toBeVisible();

    const reloaded = await page.reload();
    expect(reloaded?.status()).toBe(200);
    expect(reloaded?.headers()['content-type']).toBe('text/html; charset=utf-8');
    await expect(page.getByRole('button', { name: 'Jouer en local' })).toBeVisible();
    expect(problems).toEqual([]);
  });
});

interface EntryReply {
  readonly status: number;
  readonly cacheControl: string | null;
  readonly body: unknown;
}

/** Appel d'API depuis la page elle-même : même origine, cookies et en-têtes réels du navigateur. */
async function post(page: Page, path: string): Promise<EntryReply> {
  return page.evaluate(async (url) => {
    const response = await fetch(url, { method: 'POST' });
    return { status: response.status, cacheControl: response.headers.get('cache-control'), body: (await response.json()) as unknown };
  }, path);
}

test.describe('PFC-012 — création et réservation des rooms privées (build servi par workerd)', () => {
  test('PFC-012-S1 — J1 crée, un invité dans un autre contexte rejoint : J2 et token distinct ; un troisième est refusé', async ({
    browser,
  }) => {
    const contexts = await Promise.all([isolatedContext(browser), isolatedContext(browser), isolatedContext(browser)]);
    const [hostPage, guestPage, thirdPage] = await Promise.all(contexts.map((context) => context.newPage()));
    if (hostPage === undefined || guestPage === undefined || thirdPage === undefined) throw new Error('Pages absentes.');
    for (const page of [hostPage, guestPage, thirdPage]) {
      await stubScene(page);
      await page.goto('/');
    }

    const created = await post(hostPage, '/api/rooms');
    expect(created.status).toBe(201);
    expect(created.cacheControl).toBe('no-store');
    const host = parseRoomEntry(created.body);
    expect(host?.slot).toBe(0);
    const code = host?.roomCode ?? '';

    // Code saisi en minuscules avec espaces : normalisé par le serveur.
    const joined = await post(guestPage, `/api/rooms/${encodeURIComponent(` ${code.toLowerCase()} `)}/join`);
    expect(joined.status).toBe(200);
    const guest = parseRoomEntry(joined.body);
    expect(guest).toMatchObject({ roomCode: code, slot: 1 });
    expect(guest?.resumeToken).not.toBe(host?.resumeToken);

    const third = await post(thirdPage, `/api/rooms/${code}/join`);
    expect(third).toEqual({
      status: 409,
      cacheControl: 'no-store',
      body: { error: { code: 'ROOM_FULL', message: 'Cette partie est déjà complète.' } },
    });

    await Promise.all(contexts.map((context) => context.close()));
  });

  test('PFC-012-AC2 — code inconnu : 404 ROOM_UNAVAILABLE en JSON, jamais la page React', async ({ page }) => {
    await stubScene(page);
    await page.goto('/');
    expect(await post(page, '/api/rooms/ABSENT23/join')).toEqual({
      status: 404,
      cacheControl: 'no-store',
      body: { error: { code: 'ROOM_UNAVAILABLE', message: 'Cette partie n’existe pas ou n’est plus disponible.' } },
    });
  });
});

/** Socket d'une page de test : trames texte reçues et code de fermeture, lus depuis Playwright. */
interface SeatSocket {
  readonly frames: string[];
  closeCode: number | null;
}

declare global {
  interface Window {
    seatSocket?: SeatSocket;
  }
}

/**
 * Ouvre depuis la page la socket de sa room (même origine, `ws:` ou `wss:` selon la page) et
 * l'authentifie par la première trame ; résout à l'ack. Le token ne figure jamais dans l'URL.
 */
async function openSeat(page: Page, roomCode: string, resumeToken: string): Promise<void> {
  await page.evaluate(
    ({ code, token }) =>
      new Promise<void>((resolve, reject) => {
        const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${scheme}//${location.host}/api/rooms/${code}/ws`);
        const seat: SeatSocket = { frames: [], closeCode: null };
        window.seatSocket = seat;
        ws.addEventListener('open', () => {
          ws.send(JSON.stringify({ v: 1, type: 'authenticate', requestId: 'auth-1', payload: { resumeToken: token } }));
        });
        ws.addEventListener('message', (event) => {
          const frame = String(event.data);
          seat.frames.push(frame);
          if ((JSON.parse(frame) as { type?: unknown }).type === 'ack') resolve();
        });
        ws.addEventListener('close', (event) => {
          seat.closeCode = event.code;
          reject(new Error(`Socket fermée (${String(event.code)}).`));
        });
      }),
    { code: roomCode, token: resumeToken },
  );
}

async function seatFrames(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(() => (window.seatSocket?.frames ?? []).map((frame) => JSON.parse(frame) as Record<string, unknown>));
}

test.describe('PFC-013 — WebSocket authentifié (build servi par workerd, vrais navigateurs)', () => {
  test('PFC-013-S1 — J2 authentifie sa socket depuis sa page : état projeté pour J2, présence publiée à J1', async ({
    browser,
  }) => {
    const contexts = await Promise.all([isolatedContext(browser), isolatedContext(browser)]);
    const [hostPage, guestPage] = await Promise.all(contexts.map((context) => context.newPage()));
    if (hostPage === undefined || guestPage === undefined) throw new Error('Pages absentes.');
    for (const page of [hostPage, guestPage]) {
      await stubScene(page);
      await page.goto('/');
    }
    const host = parseRoomEntry((await post(hostPage, '/api/rooms')).body);
    const code = host?.roomCode ?? '';
    const guest = parseRoomEntry((await post(guestPage, `/api/rooms/${code}/join`)).body);
    if (host === null || guest === null) throw new Error('Entrée refusée.');

    await openSeat(hostPage, code, host.resumeToken);
    await openSeat(guestPage, code, guest.resumeToken);

    const [guestState] = await seatFrames(guestPage);
    expect(guestState).toMatchObject({ v: 1, type: 'state', roomCode: code, yourSlot: 1, phase: 'lobby', connected: [true, true] });
    await expect
      .poll(async () => (await seatFrames(hostPage)).filter((frame) => frame['type'] === 'state').at(-1))
      .toMatchObject({ yourSlot: 0, connected: [true, true] });
    for (const page of [hostPage, guestPage]) {
      const raw = JSON.stringify(await seatFrames(page));
      expect(raw).not.toContain(host.resumeToken);
      expect(raw).not.toContain(guest.resumeToken);
    }

    await Promise.all(contexts.map((context) => context.close()));
  });

  test('PFC-013-AC3 — un second onglet de J1 reprend la place : l’ancien onglet est fermé (4409)', async ({ browser }) => {
    const context = await isolatedContext(browser);
    const [firstTab, secondTab] = [await context.newPage(), await context.newPage()];
    for (const page of [firstTab, secondTab]) {
      await stubScene(page);
      await page.goto('/');
    }
    const host = parseRoomEntry((await post(firstTab, '/api/rooms')).body);
    if (host === null) throw new Error('Entrée refusée.');

    await openSeat(firstTab, host.roomCode, host.resumeToken);
    await openSeat(secondTab, host.roomCode, host.resumeToken);

    await expect.poll(() => firstTab.evaluate(() => window.seatSocket?.closeCode ?? null)).toBe(4409);
    expect(await seatFrames(secondTab)).toEqual([
      expect.objectContaining({ type: 'state', yourSlot: 0, connected: [true, false] }),
      expect.objectContaining({ type: 'ack', requestId: 'auth-1' }),
    ]);

    await context.close();
  });
});
