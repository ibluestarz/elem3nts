import type { PersistedRoom } from '../../../src/worker/codec.ts';
import { createRoom } from '../../../src/worker/entry.ts';
import { generateResumeToken, hashResumeToken } from '../../../src/worker/tokens.ts';
import type { Env } from '../../../src/worker/env.ts';
import production from '../../../src/worker/index.ts';
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
 * - `/__harness/create` (POST `{ codes }`) : création de production avec des codes imposés (collisions).
 * Le RPC reste interne au runtime : un stub tenu depuis Node empêcherait l'éviction de l'objet.
 */
export type CommitResult =
  | { readonly ok: true; readonly state: PersistedRoom }
  | { readonly ok: false; readonly code: RoomStorageErrorCode };

/** Horloge figée du harnais, partagée par les rooms de l'isolat de test (jamais en production). */
const clock: { now: number | null } = { now: null };

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

interface HarnessEnv extends Omit<Env, 'ROOMS'> {
  readonly ROOMS: DurableObjectNamespace<Room>;
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/__harness/clock') {
      clock.now = (await request.json<{ now: number | null }>()).now;
      return Response.json({ now: clock.now });
    }
    if (pathname === '/__harness/create') {
      const codes = [...(await request.json<{ codes: string[] }>()).codes];
      return createRoom(env, () => codes.shift() ?? 'ÉPUISÉ');
    }
    const match = HARNESS_ROUTE.exec(pathname);
    const name = match?.[1];
    if (name === undefined) return production.fetch(request, env);
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
  },
} satisfies ExportedHandler<HarnessEnv>;
