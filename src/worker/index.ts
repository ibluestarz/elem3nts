import { connectRoom, createRoom, joinRoom } from './entry.ts';
import type { Env } from './env.ts';
import { jsonError } from './http.ts';

export { Room } from './room.ts';

/**
 * Point d'entrée du Worker. Les fichiers statiques et le repli SPA sont servis par Static Assets
 * (`wrangler.jsonc`) ; seules les requêtes `/api` et `/api/*` passent d'abord ici (`run_worker_first`).
 * Aucun état global : toute autorité de room vit dans son Durable Object.
 */
export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await route(request, env);
    } catch {
      return jsonError('INTERNAL');
    }
  },
} satisfies ExportedHandler<Env>;

const JOIN_ROUTE = /^\/api\/rooms\/([^/]+)\/join$/;
const SOCKET_ROUTE = /^\/api\/rooms\/([^/]+)\/ws$/;

function route(request: Request, env: Env): Promise<Response> | Response {
  const { pathname } = new URL(request.url);
  if (pathname === '/api' || pathname.startsWith('/api/')) return routeApi(request, env, pathname);
  // Garde défensive : avec `run_worker_first` en liste, Static Assets sert tout le reste (repli SPA compris).
  return jsonError('NOT_FOUND');
}

/**
 * Routes de l'API (PROTOCOL « Transport et entrée dans une room ») ; toute autre route répond JSON 404,
 * une méthode autre que celle de la route JSON 405 (POST pour create/join, GET pour la socket).
 * Aucun corps de requête n'est lu.
 */
function routeApi(request: Request, env: Env, pathname: string): Promise<Response> | Response {
  const socketCode = SOCKET_ROUTE.exec(pathname)?.[1];
  if (socketCode !== undefined) return connectRoom(request, env, socketCode);
  const joinCode = JOIN_ROUTE.exec(pathname)?.[1];
  if (pathname !== '/api/rooms' && joinCode === undefined) return jsonError('NOT_FOUND');
  if (request.method !== 'POST') return jsonError('METHOD_NOT_ALLOWED');
  return joinCode === undefined ? createRoom(env) : joinRoom(env, joinCode);
}
