import type { PersistedRoom } from '../../../src/worker/codec.ts';
import { createRoom } from '../../../src/worker/entry.ts';
import { generateResumeToken, hashResumeToken } from '../../../src/worker/tokens.ts';
import type { Env } from '../../../src/worker/env.ts';
import production from '../../../src/worker/index.ts';
import { Limiter as ProductionLimiter } from '../../../src/worker/limiter.ts';
import { Room as ProductionRoom } from '../../../src/worker/room.ts';
import { RoomStorageError, type RoomStorageErrorCode } from '../../../src/worker/errors.ts';

/**
 * Entrée de test uniquement (`wrangler.jsonc` de ce dossier), jamais incluse dans le bundle déployé
 * dont l'entrée reste `src/worker/index.ts`. Elle délègue tout au Worker de production, sauf :
 * - `/__harness/rooms/:name` : écrit (PUT) ou relit (GET) l'état durable d'une room par RPC ;
 * - `/__harness/rooms/:name/fetch` : transmet la requête au `fetch` de production de la room ;
 * - `/__harness/rooms/:name/alarm` : lit (GET) l'alarme planifiée ou exécute (POST) le traitement d'alarme,
 *   dont l'échec éventuel est rendu (`failed`) comme le verrait le runtime, qui relancerait l'alarme ;
 * - `/__harness/rooms/:name/fail` (PUT `{ commits }`) : les `commits` prochaines écritures de cette instance
 *   échouent (panne de stockage simulée, PFC-014), sans rien écrire ;
 * - `/__harness/rooms/:name/burst` (POST `{ count }`) : `count` réservations de J2 lancées au même instant
 *   depuis le runtime, sans l'étalement des requêtes HTTP : la course la plus serrée possible ;
 * - `/__harness/clock` (PUT `{ now }`) : fige l'horloge des rooms de ce Worker (`null` : heure réelle) ;
 * - `/__harness/create` (POST `{ codes }`) : création de production avec des codes imposés (collisions) ;
 * - `/__harness/limiter` (POST `{ key }`) : exécute l'alarme du limiteur de cette clé d'IP puis rend la
 *   prochaine (PFC-020).
 * Le RPC reste interne au runtime : un stub tenu depuis Node empêcherait l'éviction de l'objet.
 *
 * Adresse cliente (PFC-020) : en local, toutes les requêtes viennent de 127.0.0.1 et partageraient un seul
 * budget de débit sous une horloge figée. Chaque requête reçoit donc sa propre `CF-Connecting-IP` (un /64
 * IPv6 de documentation distinct), sauf si le test impose la sienne par `x-harness-client-ip` : les tests
 * de limites de débit (`abuse.test.ts`) passent ainsi par le limiteur de production, clé comprise.
 */
export type CommitResult =
  | { readonly ok: true; readonly state: PersistedRoom }
  | { readonly ok: false; readonly code: RoomStorageErrorCode };

/** Horloge figée du harnais, partagée par les rooms et limiteurs de l'isolat de test (jamais en production). */
const clock: { now: number | null } = { now: null };

/** Compteur des adresses clientes distinctes attribuées aux requêtes sans adresse imposée. */
const addresses = { next: 0 };

/** Limiteur de production sur l'horloge figée du harnais. */
export class Limiter extends ProductionLimiter {
  protected override now(): number {
    return clock.now ?? Date.now();
  }

  /** Exécute le traitement d'alarme, puis rend l'alarme planifiée ensuite (`null` : stockage effacé). */
  async runAlarm(): Promise<number | null> {
    await this.alarm();
    return this.ctx.storage.getAlarm();
  }
}

export class Room extends ProductionRoom {
  /** Écritures encore à faire échouer ; propre à l'instance, perdue à sa reconstruction. */
  #failures = 0;

  failCommits(count: number): void {
    this.#failures = count;
  }

  protected override commit(next: PersistedRoom): PersistedRoom {
    if (this.#failures > 0) {
      this.#failures -= 1;
      throw new Error('Panne de stockage simulée.');
    }
    return super.commit(next);
  }

  read(): PersistedRoom | null {
    return this.current;
  }

  /** Les erreurs RPC ne gardent pas leurs champs : le code de refus est rendu comme une valeur. */
  write(next: PersistedRoom): CommitResult {
    try {
      return { ok: true, state: this.commit(next) };
    } catch (error) {
      if (error instanceof RoomStorageError) return { ok: false, code: error.code };
      throw error;
    }
  }

  alarmAt(): Promise<number | null> {
    return this.ctx.storage.getAlarm();
  }

  /** Traitement d'alarme ; `false` s'il a levé (le runtime relancerait alors l'alarme). */
  async runAlarm(): Promise<boolean> {
    try {
      await this.alarm();
      return true;
    } catch {
      return false;
    }
  }

  protected override now(): number {
    return clock.now ?? Date.now();
  }
}

const HARNESS_ROUTE = /^\/__harness\/rooms\/([A-Za-z0-9_-]{1,64})(\/fetch|\/alarm|\/burst|\/fail)?$/;

interface HarnessEnv extends Omit<Env, 'ROOMS' | 'LIMITER'> {
  readonly ROOMS: DurableObjectNamespace<Room>;
  readonly LIMITER: DurableObjectNamespace<Limiter>;
}

/**
 * Copie, pour le Worker de production, dotée de l'adresse cliente imposée par le test ou d'une adresse neuve
 * (voir l'en-tête du fichier). Sans corps : l'API n'en lit aucun, et l'original garde le sien, que le runtime
 * draine comme avant (un corps transféré puis jamais lu coupe la connexion réutilisée par la requête suivante).
 */
function withClientIp(request: IncomingRequest): IncomingRequest {
  const headers = new Headers(request.headers);
  const pinned = headers.get('x-harness-client-ip');
  headers.delete('x-harness-client-ip');
  addresses.next += 1;
  headers.set('cf-connecting-ip', pinned ?? `2001:db8:${(addresses.next >> 16).toString(16)}:${(addresses.next & 0xffff).toString(16)}::1`);
  // Même URL, méthode et en-têtes ; le Worker de production ne lit ni corps ni propriétés `cf`.
  return new Request(request.url, { method: request.method, headers });
}

type IncomingRequest = Parameters<typeof production.fetch>[0];

export default {
  fetch: route,
} satisfies ExportedHandler<HarnessEnv>;

async function route(request: IncomingRequest, env: HarnessEnv): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === '/__harness/clock') {
    clock.now = (await request.json<{ now: number | null }>()).now;
    return Response.json({ now: clock.now });
  }
  if (pathname === '/__harness/limiter') {
    const { key } = await request.json<{ key: string }>();
    return Response.json({ alarm: await env.LIMITER.getByName(key).runAlarm() });
  }
  if (pathname === '/__harness/create') {
    const codes = [...(await request.json<{ codes: string[] }>()).codes];
    return createRoom(env, () => codes.shift() ?? 'ÉPUISÉ');
  }
  const match = HARNESS_ROUTE.exec(pathname);
  const name = match?.[1];
  if (name === undefined) return production.fetch(withClientIp(request), env);
  const stub = env.ROOMS.getByName(name);
  if (match?.[2] === '/fetch') return stub.fetch(request);
  if (match?.[2] === '/burst') {
    const { count } = await request.json<{ count: number }>();
    const hashes = await Promise.all(Array.from({ length: count }, () => hashResumeToken(generateResumeToken())));
    const outcomes = await Promise.all(hashes.map((hash) => stub.join(hash)));
    return Response.json(outcomes.map((outcome, index) => ({ ...outcome, tokenHash: hashes[index] })));
  }
  if (match?.[2] === '/alarm') {
    const failed = request.method === 'POST' ? !(await stub.runAlarm()) : false;
    return Response.json({ alarm: await stub.alarmAt(), failed });
  }
  if (match?.[2] === '/fail') {
    await stub.failCommits((await request.json<{ commits: number }>()).commits);
    return Response.json({ ok: true });
  }
  if (request.method === 'PUT') {
    const next = await request.json<PersistedRoom>();
    return Response.json(await stub.write(next));
  }
  return Response.json({ state: await stub.read() });
}
