import { isRoomCode, normalizeRoomCode, type RoomEntry } from '../shared/protocol/index.ts';
import type { Env } from './env.ts';
import { jsonError, jsonResponse } from './http.ts';
import { clientKey, type Bucket } from './rate.ts';
import { errorName, logEvent } from './log.ts';
import { generateResumeToken, generateRoomCode, hashResumeToken } from './tokens.ts';

/** Tirages de code avant d'abandonner une création (PROTOCOL : 5 puis erreur réessayable). */
export const MAX_CODE_ATTEMPTS = 5;

/**
 * `POST /api/rooms` : tire un code, fait créer la room par son Durable Object (nommé par le code)
 * et réserve J1. Une collision retire un autre code sans jamais écraser la room existante. Le token
 * ne quitte le Worker que dans la réponse ; la room n'en reçoit que l'empreinte.
 */
export async function createRoom(env: Env, nextCode: () => string = generateRoomCode): Promise<Response> {
  const resumeToken = generateResumeToken();
  const tokenHash = await hashResumeToken(resumeToken);
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const roomCode = nextCode();
    if (!isRoomCode(roomCode)) throw new Error('Code de room généré hors alphabet.');
    const outcome = await env.ROOMS.getByName(roomCode).create(roomCode, tokenHash);
    if (outcome.kind === 'created') return entryResponse({ roomCode, slot: 0, resumeToken }, 201);
  }
  return jsonError('CODE_COLLISION');
}

/**
 * `POST /api/rooms/:code/join` : code normalisé (trim + majuscules) ; un code mal formé n'atteint
 * aucun Durable Object. Le code invite seulement : il réserve J2 avec un nouveau token distinct et ne
 * permet jamais de reprendre une place déjà réservée.
 */
export async function joinRoom(env: Env, rawCode: string): Promise<Response> {
  const roomCode = normalizeRoomCode(decodeSegment(rawCode) ?? '');
  if (roomCode === null) return jsonError('ROOM_ABSENT');
  const resumeToken = generateResumeToken();
  const tokenHash = await hashResumeToken(resumeToken);
  const outcome = await env.ROOMS.getByName(roomCode).join(tokenHash);
  switch (outcome.kind) {
    case 'reserved':
      return entryResponse({ roomCode, slot: 1, resumeToken }, 200);
    case 'full':
      return jsonError('ROOM_FULL');
    case 'absent':
      return jsonError('ROOM_ABSENT');
    case 'unavailable':
      return jsonError('ROOM_UNAVAILABLE');
  }
}

/**
 * Gardes de `POST /api/rooms` et `/join`, après la méthode (PFC-020, D45) : requête d'un autre site
 * refusée (403), **puis** limite de débit `entry` de l'IP (429). Dans cet ordre, un site tiers ne peut
 * pas consommer le budget du navigateur de sa victime. `null` : la requête peut entrer.
 */
export async function guardEntry(request: Request, env: Env): Promise<Response | null> {
  if (isCrossSite(request)) {
    logEvent('http.rejected', { code: 'ORIGIN_FORBIDDEN' });
    return jsonError('ORIGIN_FORBIDDEN');
  }
  return rateLimit(request, env, 'entry');
}

/**
 * `GET /api/rooms/:code/ws` : ouvre la socket d'une room (PFC-013). Gardes, dans l'ordre, avant
 * d'atteindre toute room : méthode GET (405), demande d'upgrade WebSocket (426), Origin identique à
 * celle du Worker (403), code bien formé (404), limite de débit `socket` de l'IP (429, PFC-020). Aucune
 * donnée n'est lue ni renvoyée avant ; le token n'arrive que dans la première trame, jamais dans l'URL.
 */
export async function connectRoom(request: Request, env: Env, rawCode: string): Promise<Response> {
  if (request.method !== 'GET') return jsonError('SOCKET_METHOD_NOT_ALLOWED');
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return jsonError('UPGRADE_REQUIRED');
  if (!isAllowedOrigin(request)) {
    logEvent('http.rejected', { code: 'ORIGIN_FORBIDDEN', bucket: 'socket' });
    return jsonError('ORIGIN_FORBIDDEN');
  }
  const roomCode = normalizeRoomCode(decodeSegment(rawCode) ?? '');
  if (roomCode === null) return jsonError('ROOM_ABSENT');
  const refusal = await rateLimit(request, env, 'socket');
  if (refusal !== null) return refusal;
  return env.ROOMS.getByName(roomCode).fetch(request);
}

/**
 * Compte la tentative dans le budget `bucket` de l'IP. Dépassement : `429 RATE_LIMITED` et `Retry-After`,
 * sans atteindre aucune room. Limiteur indisponible : la requête passe (le jeu reste jouable, la protection
 * est suspendue le temps de la panne) et la panne est journalisée.
 */
async function rateLimit(request: Request, env: Env, bucket: Bucket): Promise<Response | null> {
  let verdict;
  try {
    verdict = await env.LIMITER.getByName(clientKey(request)).take(bucket);
  } catch (error) {
    logEvent('limiter.unavailable', { bucket, error: errorName(error) });
    return null;
  }
  if (verdict.ok) return null;
  logEvent('http.rejected', { code: 'RATE_LIMITED', bucket });
  return jsonError('RATE_LIMITED', { 'retry-after': String(verdict.retryAfterS) });
}

/**
 * Fetch Metadata (PFC-020) : une requête d'un navigateur porte `Origin` et `Sec-Fetch-Site` ; l'une ou
 * l'autre désignant un autre site suffit à refuser. Leur absence (client hors navigateur, qui pourrait de
 * toute façon les forger) n'est pas un refus : la limite de débit s'applique alors seule.
 */
function isCrossSite(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== new URL(request.url).origin) return true;
  const site = request.headers.get('sec-fetch-site');
  return site !== null && site !== 'same-origin';
}

/**
 * Allowlist explicite réduite à une entrée : l'origine du Worker lui-même (même origine, PROTOCOL).
 * Un navigateur envoie toujours `Origin` sur un upgrade et ne peut pas la falsifier : une Origin
 * absente, `null` (iframe isolée, fichier local) ou d'un autre site est refusée. Aucune liste
 * configurable ni joker : le front et l'API sont servis ensemble par ce Worker, en dev comme en production.
 */
function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return origin !== null && origin === new URL(request.url).origin;
}

/** Réponse privée : jamais mise en cache (`no-store`, en-têtes JSON communs). */
function entryResponse(entry: RoomEntry, status: 200 | 201): Response {
  return jsonResponse(entry, status);
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
