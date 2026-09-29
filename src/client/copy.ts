import { TARGET_MAX, TARGET_MIN, type RoundResolution, type TargetInputError } from '../domain/index.ts';
import { PLAYER_NAMES } from './input/keys.ts';

/** Textes d'interface partagés entre écrans (français, D19). */
export const pointsLine = (target: number): string => `Premier à ${String(target)} point${target > 1 ? 's' : ''}`;

const TARGET_ERRORS: Readonly<Record<TargetInputError, string>> = {
  empty: `Indiquez un score cible entre ${String(TARGET_MIN)} et ${String(TARGET_MAX)}.`,
  'not-integer': `Le score cible doit être un nombre entier, de ${String(TARGET_MIN)} à ${String(TARGET_MAX)}.`,
  'not-a-number': `Saisissez un nombre entier entre ${String(TARGET_MIN)} et ${String(TARGET_MAX)}.`,
  'out-of-range': `Le score cible doit être compris entre ${String(TARGET_MIN)} et ${String(TARGET_MAX)}.`,
};

export const targetErrorMessage = (error: TargetInputError): string => TARGET_ERRORS[error];

export interface Banner {
  readonly title: string;
  readonly sub: string;
}

/** Noms affichés des deux places : Joueur 1 et 2 en local, « Vous » et l'adversaire en ligne (maquette `names`). */
export type PlayerNames = readonly [string, string];

/**
 * Explication d'une manche, textes de la maquette (`resolve`/`applyRes`). `round` est exprimé dans
 * l'ordre des noms affichés (en ligne : soi d'abord).
 */
export function roundBanner(
  round: Pick<RoundResolution, 'kind' | 'winner' | 'before'>,
  names: PlayerNames = PLAYER_NAMES,
): Banner {
  const winner = round.winner === null ? '' : names[round.winner];
  const floored = round.kind === 'siphon' && round.before.some((score) => score === 0);
  const texts: Record<RoundResolution['kind'], Banner> = {
    void: { title: 'Temps écoulé', sub: 'Aucun choix — la manche est annulée' },
    solo: { title: 'Temps écoulé', sub: `Seul choix de la manche : point pour ${winner}` },
    // Exigence du propriétaire (D41) : éléments identiques, titre imagé et effet sur les scores, hors maquette.
    flare: { title: 'Les flammes s’embrasent', sub: '+1 pour les 2 joueurs' },
    siphon: { title: 'La mer engloutit tout', sub: '−1 pour les 2 joueurs' },
    balance: { title: 'Le calme de la forêt', sub: 'Rien ne se passe' },
    thrive: { title: 'Plante + Plante', sub: `Le plus faible grandit : +1 pour ${winner}` },
    wave: { title: 'L’Eau éteint le Feu', sub: `+1 pour ${winner}` },
    burn: { title: 'Le Feu consume la Plante', sub: `+1 pour ${winner}` },
    grow: { title: 'La Plante absorbe l’Eau', sub: `+1 pour ${winner}` },
  };
  const banner = texts[round.kind];
  return floored ? { ...banner, sub: `${banner.sub} (score minimum : 0)` } : banner;
}

export const OPENING_TITLE = 'Que le duel commence';
export const SUDDEN_BANNER: Banner = {
  title: 'Mort subite',
  sub: 'Les deux joueurs ont atteint la cible — le prochain écart décide',
};

/** Variation affichée d'une manche : `+1`, `−1` (signe moins typographique) ou `±0`. */
export const deltaLabel = (delta: number): '+1' | '−1' | '±0' => (delta > 0 ? '+1' : delta < 0 ? '−1' : '±0');
