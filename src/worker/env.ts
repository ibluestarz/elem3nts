import type { Limiter } from './limiter.ts';
import type { Room } from './room.ts';

/** Liaisons du Worker, déclarées dans `wrangler.jsonc`. Aucun secret à ce stade. */
export interface Env {
  /** Un Durable Object SQLite par room : seule autorité de ses deux places (ARCHITECTURE « État et atomicité »). */
  readonly ROOMS: DurableObjectNamespace<Room>;
  /** Un Durable Object SQLite par clé d'IP : seule autorité de ses limites de débit (PFC-020, D45). */
  readonly LIMITER: DurableObjectNamespace<Limiter>;
}
