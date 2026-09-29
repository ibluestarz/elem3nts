import { DurableObject } from 'cloudflare:workers';
import { RATE_WINDOW_MS } from '../shared/protocol/index.ts';
import type { Env } from './env.ts';
import { BUCKET_LIMITS, admit, prune, type Bucket, type Verdict } from './rate.ts';

/**
 * Limites de débit par IP (PFC-020, D45) : un Durable Object `Limiter` par clé d'IP (`clientKey`), seule
 * autorité de ses compteurs, jamais un compteur global en mémoire du Worker (PROTOCOL « Idempotence et
 * validation »). Chaque décision est synchrone entre la lecture et l'écriture (stockage clé-valeur
 * synchrone, aucun `await`) : une rafale concurrente de la même IP est sérialisée et n'obtient jamais plus
 * que la limite. Règles de décision : `rate.ts`.
 */

const BUCKETS = Object.keys(BUCKET_LIMITS) as Bucket[];

/**
 * Durable Object d'une clé d'IP. Stockage : un journal d'instants par budget ; une alarme l'efface dès
 * que toutes ses tentatives sont sorties de la fenêtre, pour ne rien garder d'une IP inactive.
 */
export class Limiter extends DurableObject<Env> {
  /** Horloge serveur (le harnais de test la fige ; jamais la production). */
  protected now(): number {
    return Date.now();
  }

  /** Compte une tentative sur `bucket` : décision et écriture sans `await` entre elles. */
  async take(bucket: Bucket): Promise<Verdict> {
    const now = this.now();
    const { verdict, log } = admit(this.#read(bucket), now, BUCKET_LIMITS[bucket], RATE_WINDOW_MS);
    this.ctx.storage.kv.put(bucket, log);
    await this.#schedule();
    return verdict;
  }

  /** Élague les journaux ; efface tout le stockage s'il ne reste aucune tentative dans la fenêtre. */
  override async alarm(): Promise<void> {
    const now = this.now();
    for (const bucket of BUCKETS) this.ctx.storage.kv.put(bucket, prune(this.#read(bucket), now, RATE_WINDOW_MS));
    await this.#schedule();
  }

  /** Alarme à l'instant où la dernière tentative sort de la fenêtre ; stockage effacé s'il n'y en a plus. */
  async #schedule(): Promise<void> {
    const latest = Math.max(-Infinity, ...BUCKETS.flatMap((bucket) => this.#read(bucket)));
    if (latest === -Infinity) {
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.ctx.storage.setAlarm(latest + RATE_WINDOW_MS);
  }

  /** Journal d'un budget ; une valeur hors forme (jamais écrite par ce code) repart à vide. */
  #read(bucket: Bucket): readonly number[] {
    const stored = this.ctx.storage.kv.get(bucket);
    return Array.isArray(stored) && stored.every((at) => Number.isFinite(at)) ? (stored as number[]) : [];
  }
}
