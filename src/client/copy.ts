import { TARGET_MAX, TARGET_MIN, type Choices, type RoundKind, type RoundResolution, type Scores, type TargetInputError } from '../domain/index.ts';
import { ELEMENT_NAMES, PLAYER_NAMES } from './input/keys.ts';

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

/**
 * Annonce complète d'un résultat pour lecteurs d'écran (région live de l'arène) : choix révélés,
 * explication et scores, dans l'ordre des noms affichés.
 */
export function resultAnnouncement(names: PlayerNames, choices: Choices, banner: Banner, scores: Scores): string {
  const picks = ([0, 1] as const)
    .map((side) => {
      const element = choices[side];
      return `${names[side]} : ${element ? ELEMENT_NAMES[element] : 'aucun choix'}`;
    })
    .join(', ');
  return `${picks}. ${banner.title} — ${banner.sub}. Score ${String(scores[0])} à ${String(scores[1])}.`;
}

/** Démo des confrontations (maquette `demoIds`) : libellé de chaque bouton. */
export const DEMO_LABELS: Readonly<Record<RoundKind, string>> = {
  wave: 'Eau › Feu',
  burn: 'Feu › Plante',
  grow: 'Plante › Eau',
  flare: 'Feu + Feu',
  siphon: 'Eau + Eau',
  thrive: 'Plante + Plante · écart',
  balance: 'Plante + Plante · égalité',
  solo: 'Temps écoulé',
  void: 'Aucun choix',
};

export const OPENING_TITLE = 'Que le duel commence';
export const SUDDEN_BANNER: Banner = {
  title: 'Mort subite',
  sub: 'Les deux joueurs ont atteint la cible — le prochain écart décide',
};

/** Variation affichée d'une manche : `+1`, `−1` (signe moins typographique) ou `±0`. */
export const deltaLabel = (delta: number): '+1' | '−1' | '±0' => (delta > 0 ? '+1' : delta < 0 ? '−1' : '±0');

/** Voile du tour par tour sur un seul téléphone (maquette `gate*`, PFC-025). */
export interface TurnGateCopy {
  readonly label: string;
  readonly title: string;
  readonly sub: string;
  readonly button: string;
}

/** Textes du voile de `player` à la manche `round` ; `firstLocked` : Joueur 1 a choisi à temps. */
export function turnGateCopy(round: number, player: 0 | 1, firstLocked: boolean): TurnGateCopy {
  const label = `Manche ${String(round)} · tour par tour`;
  if (player === 0) {
    return {
      label,
      title: `${PLAYER_NAMES[0]}, à vous`,
      sub: `${PLAYER_NAMES[1]} détourne les yeux. Vous aurez 5 secondes pour toucher un élément.`,
      button: 'Je suis prêt',
    };
  }
  return {
    label,
    title: `Passez le téléphone à ${PLAYER_NAMES[1]}`,
    sub: firstLocked
      ? `Le choix de ${PLAYER_NAMES[0]} est verrouillé et caché. ${PLAYER_NAMES[1]} aura 5 secondes.`
      : `${PLAYER_NAMES[0]} n’a pas choisi à temps. ${PLAYER_NAMES[1]} aura 5 secondes.`,
    button: `${PLAYER_NAMES[1]} — je suis prêt`,
  };
}
