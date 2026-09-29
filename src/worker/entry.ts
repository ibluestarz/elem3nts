import { isRoomCode, normalizeRoomCode, type RoomEntry } from '../shared/protocol/index.ts';
import type { Env } from './env.ts';
import { jsonError, jsonResponse } from './http.ts';
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
 * `GET /api/rooms/:code/ws` : ouvre la socket d'une room (PFC-013). Gardes, dans l'ordre, avant
 * d'atteindre toute room : méthode GET (405), demande d'upgrade WebSocket (426), Origin identique à
 * celle du Worker (403), code bien formé (404). Aucune donnée n'est lue ni renvoyée avant ; le token
 * n'arrive que dans la première trame, jamais dans l'URL.
 */
export function connectRoom(request: Request, env: Env, rawCode: string): Promise<Response> | Response {
  if (request.method !== 'GET') return jsonError('SOCKET_METHOD_NOT_ALLOWED');
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return jsonError('UPGRADE_REQUIRED');
  if (!isAllowedOrigin(request)) return jsonError('ORIGIN_FORBIDDEN');
  const roomCode = normalizeRoomCode(decodeSegment(rawCode) ?? '');
  if (roomCode === null) return jsonError('ROOM_ABSENT');
  return env.ROOMS.getByName(roomCode).fetch(request);
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
