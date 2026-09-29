import { describe, expect, it } from 'vitest';
import { deltaLabel, roundBanner } from '../../../src/client/copy.ts';
import { resolveRound, type Choice, type Scores } from '../../../src/domain/index.ts';

const banner = (scores: Scores, p1: Choice, p2: Choice) => roundBanner(resolveRound(scores, [p1, p2]));

describe('PFC-006 — textes de résultat de la maquette', () => {
  it.each<[Scores, Choice, Choice, string, string]>([
    [[0, 0], 'water', 'fire', 'L’Eau éteint le Feu', '+1 pour Joueur 1'],
    [[0, 0], 'plant', 'fire', 'Le Feu consume la Plante', '+1 pour Joueur 2'],
    [[0, 0], 'plant', 'water', 'La Plante absorbe l’Eau', '+1 pour Joueur 1'],
    [[0, 0], 'fire', 'fire', 'Les flammes s’embrasent', '+1 pour les 2 joueurs'],
    [[2, 2], 'water', 'water', 'La mer engloutit tout', '−1 pour les 2 joueurs'],
    [[2, 2], 'plant', 'plant', 'Le calme de la forêt', 'Rien ne se passe'],
    [[3, 1], 'plant', 'plant', 'Plante + Plante', 'Le plus faible grandit : +1 pour Joueur 2'],
    [[0, 0], null, 'water', 'Temps écoulé', 'Seul choix de la manche : point pour Joueur 2'],
    [[0, 0], null, null, 'Temps écoulé', 'Aucun choix — la manche est annulée'],
  ])('%j %s/%s → « %s », « %s »', (scores, p1, p2, title, sub) => {
    expect(banner(scores, p1, p2)).toEqual({ title, sub });
  });

  it('signale le plancher zéro sur Eau + Eau (maquette : « score minimum : 0 »)', () => {
    expect(banner([0, 3], 'water', 'water').sub).toBe('−1 pour les 2 joueurs (score minimum : 0)');
    expect(banner([1, 3], 'water', 'water').sub).toBe('−1 pour les 2 joueurs');
  });

  it('libelle les variations effectives : +1, −1 (signe moins) et ±0', () => {
    expect([1, -1, 0].map(deltaLabel)).toEqual(['+1', '−1', '±0']);
  });
});
