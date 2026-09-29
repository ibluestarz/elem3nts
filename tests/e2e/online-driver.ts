import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { parseRoomEntry, parseServerMessage, type PublicState } from '../../src/shared/protocol/index.ts';
import { isolatedContext, stubScene, trackProblems } from './support.ts';

/**
 * Joueurs en ligne contre le Worker local réel (workerd) : contextes de navigateur indépendants, vraies
 * rooms et vraies sockets, aucune trame simulée (PFC-015, PFC-016). Chaque trame est enregistrée telle
 * qu'elle a circulé, pour prouver l'absence de fuite avant révélation.
 */

export interface Frame {
  readonly direction: 'sent' | 'received';
  readonly payload: string;
}

export interface Player {
  readonly context: BrowserContext;
  readonly page: Page;
  /** États reçus par la socket de la page, validés par le schéma partagé. */
  readonly states: PublicState[];
  /** Trames brutes, dans l'ordre, dans les deux sens. */
  readonly frames: Frame[];
  /** Textes passés au presse-papier par la page (`navigator.clipboard.writeText` observé). */
  readonly copied: () => Promise<string[]>;
  readonly problems: string[];
  /** Tous les messages de console de la page, quel que soit leur niveau (PFC-019 : aucun token). */
  readonly logs: string[];
}

/** Observe les copies sans modifier le comportement du presse-papier du navigateur. */
const OBSERVE_CLIPBOARD = () => {
  const copied: string[] = [];
  (window as unknown as { __copied: string[] }).__copied = copied;
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (!clipboard) return;
  Object.defineProperty(clipboard, 'writeText', {
    configurable: true,
    value: (text: string) => {
      copied.push(text);
      return Promise.resolve();
    },
  });
};

const text = (payload: string | Buffer) => (typeof payload === 'string' ? payload : payload.toString('utf8'));

export async function player(browser: Browser, viewport = { width: 1280, height: 800 }, realClipboard = false): Promise<Player> {
  return playerIn(await isolatedContext(browser, { viewport, locale: 'fr-FR' }), realClipboard);
}

/**
 * Joueur dans un contexte fourni. Contre un Worker déployé (smoke staging, PFC-022), le contexte n'usurpe pas
 * `CF-Connecting-IP` : Cloudflare pose l'adresse réelle et les limites par IP s'appliquent pour de vrai.
 */
export async function playerIn(context: BrowserContext, realClipboard = false): Promise<Player> {
  if (realClipboard) await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  await stubScene(page);
  if (!realClipboard) await page.addInitScript(OBSERVE_CLIPBOARD);
  const states: PublicState[] = [];
  const frames: Frame[] = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      frames.push({ direction: 'received', payload: text(payload) });
      const parsed = parseServerMessage(text(payload));
      if (parsed.ok && parsed.message.type === 'state') states.push(parsed.message);
    });
    socket.on('framesent', ({ payload }) => {
      frames.push({ direction: 'sent', payload: text(payload) });
    });
  });
  const problems = trackProblems(page);
  const logs: string[] = [];
  page.on('console', (message) => logs.push(message.text()));
  return {
    context,
    page,
    states,
    frames,
    problems,
    logs,
    copied: () =>
      realClipboard
        ? page.evaluate(async () => [await navigator.clipboard.readText()])
        : page.evaluate(() => (window as unknown as { __copied: string[] }).__copied),
  };
}

export async function openOnline(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  if (path === '/') await page.getByRole('button', { name: 'Jouer en ligne' }).click();
}

/** J1 crée la room : renvoie le code affiché et le token reçu (pour prouver qu'il ne fuit nulle part). */
export async function host(page: Page): Promise<{ code: string; token: string }> {
  await openOnline(page);
  const response = page.waitForResponse((reply) => reply.url().endsWith('/api/rooms') && reply.request().method() === 'POST');
  await page.getByRole('button', { name: /^Créer une partie/ }).click();
  const entry = parseRoomEntry(await (await response).json());
  if (!entry) throw new Error('Réponse de création invalide.');
  await expect(page.getByText('En attente d’un adversaire')).toBeVisible();
  const code = await page.locator('[data-room-code]').getAttribute('data-room-code');
  expect(code).toBe(entry.roomCode);
  return { code: entry.roomCode, token: entry.resumeToken };
}

export async function join(page: Page, code: string): Promise<void> {
  await openOnline(page);
  await page.getByRole('button', { name: /^Rejoindre une partie/ }).click();
  await page.getByLabel('Code reçu').fill(code);
  await page.getByRole('button', { name: 'Rejoindre', exact: true }).click();
}

export const lobbyTitle = (page: Page) => page.getByRole('heading', { name: 'Préparer le duel' });

/**
 * Deux joueurs au lobby, X réglé par l'hôte, puis deux confirmations : la partie s'ouvre. Rend le code
 * et les tokens de J1 et J2 reçus à l'entrée (pour prouver qu'ils ne circulent nulle part ensuite).
 */
export async function startDuel(j1: Player, j2: Player, target: number): Promise<{ code: string; tokens: readonly [string, string] }> {
  const { code, token } = await host(j1.page);
  const joined = j2.page.waitForResponse((reply) => reply.url().endsWith(`/api/rooms/${code}/join`) && reply.request().method() === 'POST');
  await join(j2.page, code);
  const guest = parseRoomEntry(await (await joined).json());
  if (!guest) throw new Error('Réponse de jonction invalide.');
  await expect(lobbyTitle(j2.page)).toBeVisible();
  for (let step = 3; step > target; step -= 1) {
    await j1.page.getByRole('button', { name: 'Diminuer le score cible' }).click();
  }
  await expect(j2.page.getByText(target > 1 ? `Premier à ${String(target)} points` : 'Premier à 1 point')).toBeVisible();
  await j1.page.getByRole('button', { name: /^Prêt/ }).click();
  await expect(j2.page.getByRole('listitem').filter({ hasText: 'Joueur 1' })).toContainText('Prêt');
  await j2.page.getByRole('button', { name: /^Prêt/ }).click();
  for (const { page } of [j1, j2]) await expect(page.getByText('Que le duel commence')).toBeVisible();
  return { code, tokens: [token, guest.resumeToken] };
}

/** Arène en sélection : la fenêtre de 5 s publiée par le serveur est ouverte. */
export async function toSelection(page: Page): Promise<void> {
  await expect(page.locator('.arena[data-phase="selecting"]')).toBeVisible({ timeout: 10_000 });
}

/** Statut affiché sous le score d'un côté (0 : soi, 1 : l'adversaire), sur bureau comme au téléphone. */
export const hudStatus = (page: Page, side: 0 | 1) => {
  const n = String(side + 1);
  return page.locator(`.arena__player--p${n} .arena__status, .arena-m__player--p${n} .arena-m__status`);
};
