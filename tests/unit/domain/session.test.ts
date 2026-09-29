import { describe, expect, it } from 'vitest';
import {
  DomainError,
  cancelMatch,
  playRound,
  settleMatch,
  startMatch,
  startSession,
  type Choices,
  type Match,
  type MatchSettings,
  type Session,
} from '../../../src/domain/index.ts';

const FIRE_FIRE: Choices = ['fire', 'fire'];
const J1_WINS: Choices = ['fire', 'plant'];
const J2_WINS: Choices = ['plant', 'fire'];

function play(match: Match, ...rounds: Choices[]): Match {
  return rounds.reduce((current, choices) => playRound(current, choices).match, match);
}

const ON_3: MatchSettings = { target: 3, drawEnabled: true };
const OFF_3: MatchSettings = { target: 3, drawEnabled: false };
const j1Wins = (id: string) => play(startMatch(id, ON_3), J1_WINS, J1_WINS, J1_WINS);
const j2Wins = (id: string) => play(startMatch(id, ON_3), J2_WINS, J2_WINS, J2_WINS);
const draw = (id: string) => play(startMatch(id, ON_3), FIRE_FIRE, FIRE_FIRE, FIRE_FIRE);

function settleAll(session: Session, ...matches: Match[]): Session {
  return matches.reduce((current, match) => settleMatch(current, match).session, session);
}

describe('PFC-003 — trophées des scénarios', () => {
  it('PFC-003-S1 — le nul simultané donne un trophée à chacun', () => {
    const { session, awarded, applied } = settleMatch(startSession(), draw('m1'));

    expect(applied).toBe(true);
    expect(awarded).toEqual([1, 1]);
    expect(session.trophies).toEqual([1, 1]);
  });

  it('PFC-003-S2 — la victoire en prolongation donne un seul trophée à J1', () => {
    const ended = play(startMatch('m1', OFF_3), FIRE_FIRE, FIRE_FIRE, FIRE_FIRE, J1_WINS);
    expect(ended).toMatchObject({ scores: [4, 3], result: { status: 'won', winner: 0 } });

    const once = settleMatch(startSession(), ended);
    const twice = settleMatch(once.session, ended);

    expect(once.awarded).toEqual([1, 0]);
    expect(twice.session.trophies).toEqual([1, 0]);
  });
});

describe('PFC-003-AC3 — attribution unique par matchId', () => {
  it('ignore un résultat répété du même matchId : même session, rien d’attribué', () => {
    const first = settleMatch(startSession(), j1Wins('m1'));
    const replay = settleMatch(first.session, j1Wins('m1'));

    expect(replay).toEqual({ session: first.session, awarded: [0, 0], applied: false });
    expect(replay.session).toBe(first.session);
  });

  it('ignore un replay d’une ancienne partie après des parties plus récentes', () => {
    const session = settleAll(startSession(), j1Wins('m1'), j2Wins('m2'), draw('m3'));
    const replay = settleMatch(session, j1Wins('m1'));

    expect(session.trophies).toEqual([2, 2]);
    expect(replay.applied).toBe(false);
    expect(replay.session.trophies).toEqual([2, 2]);
  });

  it('ignore un replay qui prétendrait un autre résultat pour un matchId déjà réglé', () => {
    const session = settleAll(startSession(), j1Wins('m1'));

    expect(settleMatch(session, j2Wins('m1')).session.trophies).toEqual([1, 0]);
    expect(settleMatch(session, draw('m1')).session.trophies).toEqual([1, 0]);
  });

  it('une annulation ne récompense personne et verrouille son matchId', () => {
    const cancelled = cancelMatch(play(startMatch('m1', ON_3), J1_WINS, J1_WINS));
    const settled = settleMatch(startSession(), cancelled);

    expect(settled).toMatchObject({ awarded: [0, 0], applied: true });
    expect(settled.session).toMatchObject({ trophies: [0, 0], settledMatchIds: ['m1'] });
    // Un résultat du même matchId arrivé après l'annulation n'est pas récompensé.
    expect(settleMatch(settled.session, j1Wins('m1')).session.trophies).toEqual([0, 0]);
  });

  it('refuse d’attribuer une partie en cours, sans modifier la session', () => {
    const session = settleAll(startSession(), draw('m1'));
    const playing = play(startMatch('m2', ON_3), J1_WINS);

    expect(() => settleMatch(session, playing)).toThrow(DomainError);
    expect(() => settleMatch(session, playing)).toThrow(expect.objectContaining({ code: 'MATCH_NOT_OVER' }));
    expect(session).toMatchObject({ trophies: [1, 1], settledMatchIds: ['m1'] });
  });
});

describe('PFC-003 — session sur plusieurs matchId', () => {
  it('cumule victoires, nuls et annulations dans l’ordre des parties', () => {
    const session = settleAll(
      startSession(),
      j1Wins('m1'),
      draw('m2'),
      cancelMatch(startMatch('m3', ON_3)),
      j2Wins('m4'),
      j1Wins('m5'),
    );

    expect(session.trophies).toEqual([3, 2]);
    expect(session.settledMatchIds).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
  });

  it('commence à 0/0 et ne modifie jamais une session précédente', () => {
    const empty = startSession();
    const after = settleAll(empty, j1Wins('m1'));

    expect(empty).toEqual({ trophies: [0, 0], settledMatchIds: [] });
    expect(after.trophies).toEqual([1, 0]);
    for (const part of [empty, empty.trophies, after, after.trophies, after.settledMatchIds]) {
      expect(Object.isFrozen(part)).toBe(true);
    }
  });

  it('deux sessions sont indépendantes (D13/D14 : pas de trophées entre sessions)', () => {
    const first = settleAll(startSession(), j1Wins('m1'));
    const second = settleAll(startSession(), j1Wins('m1'));

    expect(first.trophies).toEqual([1, 0]);
    expect(second.trophies).toEqual([1, 0]);
  });
});
