import { ENTRY_RATE_LIMIT, SOCKET_RATE_LIMIT } from '../shared/protocol/index.ts';

/**
 * Règles pures des limites de débit par IP (PFC-020, D45) : aucune horloge, aucun stockage. Le Durable
 * Object `Limiter` (`limiter.ts`) fournit `now`, lit et écrit les journaux.
 *
 * Fenêtre glissante exacte : une tentative admise est datée ; une nouvelle est admise si moins de `limit`
 * tentatives admises datent de moins de `windowMs`. Une tentative refusée n'est pas comptée : un client
 * qui réessaie après un 429 n'allonge pas sa propre attente.
 */

/** `entry` : créations et jonctions (budget commun) ; `socket` : ouvertures de socket de room. */
export type Bucket = 'entry' | 'socket';

export const BUCKET_LIMITS: Readonly<Record<Bucket, number>> = Object.freeze({
  entry: ENTRY_RATE_LIMIT,
  socket: SOCKET_RATE_LIMIT,
});

export type Verdict = { readonly ok: true } | { readonly ok: false; readonly retryAfterS: number };

/**
 * Décision pure. `log` : instants des tentatives admises (croissants). Une tentative datée d'exactement
 * `now - windowMs` est sortie de la fenêtre. Rend la décision et le journal élagué (complété si admise).
 */
export function admit(
  log: readonly number[],
  now: number,
  limit: number,
  windowMs: number,
): { readonly verdict: Verdict; readonly log: readonly number[] } {
  const recent = prune(log, now, windowMs);
  const oldest = recent[0];
  if (recent.length >= limit && oldest !== undefined) {
    return { verdict: { ok: false, retryAfterS: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) }, log: recent };
  }
  return { verdict: { ok: true }, log: [...recent, now] };
}

/** Tentatives encore dans la fenêtre à `now`. */
export function prune(log: readonly number[], now: number, windowMs: number): readonly number[] {
  return log.filter((at) => at > now - windowMs);
}

/** Clé partagée des requêtes sans adresse exploitable : échec fermé, elles se partagent un seul budget. */
export const UNKNOWN_CLIENT = 'unknown';

/**
 * Clé de limitation d'une requête : `CF-Connecting-IP`, posé par Cloudflare (un client ne peut pas le
 * choisir en production). IPv4 : l'adresse ; IPv4 dans IPv6 (`::ffff:a.b.c.d`) : la même clé qu'en IPv4 ;
 * IPv6 : le préfixe /64, qu'un seul abonné détient d'ordinaire en entier (une clé par adresse serait
 * contournée en changeant les 64 bits bas). Absente ou illisible : `unknown`.
 */
export function clientKey(request: Request): string {
  const raw = request.headers.get('cf-connecting-ip')?.trim() ?? '';
  const v4 = parseIPv4(raw);
  if (v4 !== null) return `v4:${v4.join('.')}`;
  const v6 = parseIPv6(raw);
  if (v6 === null) return UNKNOWN_CLIENT;
  const mapped = v6.slice(0, 6).every((part, index) => part === (index === 5 ? 0xffff : 0));
  if (mapped) return `v4:${String(v6[6] >> 8)}.${String(v6[6] & 0xff)}.${String(v6[7] >> 8)}.${String(v6[7] & 0xff)}`;
  return `v6:${v6
    .slice(0, 4)
    .map((part) => part.toString(16))
    .join(':')}::/64`;
}

function parseIPv4(text: string): number[] | null {
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)?.slice(1).map(Number);
  return parts?.every((part) => part <= 255) ? parts : null;
}

/** Huit groupes de 16 bits, `::` et IPv4 final compris ; `null` si l'écriture n'est pas une IPv6. */
function parseIPv6(text: string): [number, number, number, number, number, number, number, number] | null {
  if (!/^[0-9A-Fa-f:.]{2,45}$/.test(text)) return null;
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const groups = (half: string | undefined): number[] | null => {
    if (half === undefined || half === '') return [];
    const out: number[] = [];
    const parts = half.split(':');
    for (const [index, part] of parts.entries()) {
      if (index === parts.length - 1 && part.includes('.')) {
        const v4 = parseIPv4(part);
        if (v4 === null) return null;
        const [a = 0, b = 0, c = 0, d = 0] = v4;
        out.push((a << 8) | b, (c << 8) | d);
      } else if (/^[0-9A-Fa-f]{1,4}$/.test(part)) out.push(Number.parseInt(part, 16));
      else return null;
    }
    return out;
  };
  const head = groups(halves[0]);
  const tail = groups(halves[1]);
  if (head === null || tail === null) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array<number>(Math.max(0, missing)).fill(0), ...tail];
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = all;
  return [a, b, c, d, e, f, g, h];
}
