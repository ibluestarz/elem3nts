import { describe, expect, it } from 'vitest';
import { RoomStorageError } from '../../src/worker/errors.ts';
import { errorName, logRecord } from '../../src/worker/log.ts';
import { UNKNOWN_CLIENT, admit, clientKey, prune } from '../../src/worker/rate.ts';

/** Règles pures des limites de débit et du journal structuré (PFC-020, D45) : Node, sans runtime. */

const WINDOW = 60_000;
const T0 = 2_000_000_000_000;

const withIp = (ip: string | null): Request =>
  new Request('https://elem3nts.example/api/rooms', ip === null ? {} : { headers: { 'cf-connecting-ip': ip } });

describe('PFC-020-AC1 — fenêtre glissante exacte', () => {
  it('admet `limit` tentatives dans la fenêtre, refuse la suivante avec le délai d’attente', () => {
    let log: readonly number[] = [];
    for (let index = 0; index < 10; index += 1) {
      const next = admit(log, T0 + index * 1000, 10, WINDOW);
      expect(next.verdict).toEqual({ ok: true });
      log = next.log;
    }
    const refused = admit(log, T0 + 10_000, 10, WINDOW);
    // La plus ancienne (T0) sort à T0 + 60 s : 50 s d'attente.
    expect(refused.verdict).toEqual({ ok: false, retryAfterS: 50 });
    // Un refus n'est pas compté.
    expect(refused.log).toEqual(log);
  });

  it('une tentative datée d’exactement `now - window` est sortie ; une milliseconde avant, elle compte', () => {
    const log = Array.from({ length: 10 }, () => T0);
    expect(admit(log, T0 + WINDOW - 1, 10, WINDOW).verdict).toEqual({ ok: false, retryAfterS: 1 });
    expect(admit(log, T0 + WINDOW, 10, WINDOW)).toEqual({ verdict: { ok: true }, log: [T0 + WINDOW] });
  });

  it('les refus répétés n’allongent jamais l’attente', () => {
    const log = Array.from({ length: 10 }, () => T0);
    for (let at = T0 + 1; at < T0 + WINDOW; at += 7_000) {
      const { verdict, log: kept } = admit(log, at, 10, WINDOW);
      expect(verdict.ok).toBe(false);
      expect(kept).toEqual(log);
    }
    expect(admit(log, T0 + WINDOW, 10, WINDOW).verdict.ok).toBe(true);
  });

  it('prune ne garde que les tentatives encore dans la fenêtre', () => {
    expect(prune([T0, T0 + 10, T0 + 20], T0 + WINDOW + 10, WINDOW)).toEqual([T0 + 20]);
    expect(prune([T0], T0 + WINDOW, WINDOW)).toEqual([]);
  });
});

describe('PFC-020-AC1 — clé de limitation par IP', () => {
  it.each([
    ['198.51.100.7', 'v4:198.51.100.7'],
    ['  198.51.100.7 ', 'v4:198.51.100.7'],
    ['198.051.100.007', 'v4:198.51.100.7'],
    ['::ffff:198.51.100.7', 'v4:198.51.100.7'],
    ['::FFFF:c633:6407', 'v4:198.51.100.7'],
    ['2001:db8:1:2::1', 'v6:2001:db8:1:2::/64'],
    ['2001:0db8:0001:0002:ffff:ffff:ffff:ffff', 'v6:2001:db8:1:2::/64'],
    ['2001:DB8:1:2:0:0:0:9', 'v6:2001:db8:1:2::/64'],
    ['2001:db8::', 'v6:2001:db8:0:0::/64'],
    ['::1', 'v6:0:0:0:0::/64'],
    ['64:ff9b::198.51.100.7', 'v6:64:ff9b:0:0::/64'],
  ])('%s → %s', (ip, key) => {
    expect(clientKey(withIp(ip))).toBe(key);
  });

  it('deux adresses du même /64 partagent un budget ; deux /64 voisins non', () => {
    expect(clientKey(withIp('2001:db8:1:2::a'))).toBe(clientKey(withIp('2001:db8:1:2:ffff::b')));
    expect(clientKey(withIp('2001:db8:1:2::a'))).not.toBe(clientKey(withIp('2001:db8:1:3::a')));
  });

  it.each([
    [null],
    [''],
    ['256.1.1.1'],
    ['1.2.3'],
    ['1.2.3.4.5'],
    ['2001:db8::1::2'],
    ['2001:db8:1:2:3:4:5:6:7'],
    ['2001:db8:1:2:3:4:5'],
    ['12345::1'],
    ['fe80::1%eth0'],
    ['localhost'],
    ['<script>'],
  ])('adresse absente ou illisible %j → budget commun `unknown` (échec fermé)', (ip) => {
    expect(clientKey(withIp(ip))).toBe(UNKNOWN_CLIENT);
  });
});

describe('PFC-020-AC2 — journal structuré à allowlist', () => {
  it('ne garde que les champs de l’allowlist, définis, dans un ordre stable', () => {
    const fields = {
      error: 'Error',
      revision: 4,
      room: 'ab12',
      match: null,
      requestId: 'jeton-choisi-par-le-client',
      resumeToken: 'secret',
      payload: { element: 'fire' },
      slot: undefined,
    };
    const record = logRecord('message.rejected', fields as unknown as Parameters<typeof logRecord>[1]);
    expect(record).toEqual({ event: 'message.rejected', room: 'ab12', match: null, revision: 4, error: 'Error' });
    expect(Object.keys(record)).toEqual(['event', 'room', 'match', 'revision', 'error']);
    expect(JSON.stringify(record)).not.toMatch(/jeton|secret|fire/);
  });

  it('d’une erreur, seul le nom est gardé ; le code s’y ajoute pour une erreur de stockage', () => {
    expect(errorName(new TypeError('token=abc'))).toBe('TypeError');
    expect(errorName(new RoomStorageError('CORRUPT', 'détail'))).toBe('RoomStorageError:CORRUPT');
    expect(errorName('chaîne levée avec un token')).toBe('string');
  });
});
