import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stage from '../../../src/client/Stage.tsx';
import type { Engine } from '../../../src/client/scene/engine.js';
import { SceneContext, SCENE_LOADING, sceneFallback, type SceneState } from '../../../src/client/scene/sceneContext.ts';
import { CYCLE_MS, clashDelays } from '../../../src/client/state/game.ts';

const ARENA_BANNER_MS = CYCLE_MS.banner;
const SELECTION_DELAY_MS = CYCLE_MS.ready;
import { defaultPreferences, updatePreferences } from '../../../src/client/state/preferences.ts';

function renderStage() {
  return render(
    <StrictMode>
      <Stage />
    </StrictMode>,
  );
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const spinbutton = () => screen.getByRole('spinbutton', { name: 'Score cible' });
const press = (key: string, code: string, init: KeyboardEventInit = {}) => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key, code, ...init });
};
const space = (init: KeyboardEventInit = {}) => {
  press(' ', 'Space', init);
};
const escape = () => {
  press('Escape', 'Escape');
};

function toSetup() {
  fireEvent.click(button('Jouer en local'));
  expect(screen.getByRole('heading', { name: 'Préparer le duel' })).toHaveFocus();
}

beforeEach(() => {
  localStorage.clear();
  updatePreferences(defaultPreferences());
  // jsdom ne calcule pas de mise en page : scène de bureau simulée (seuil maquette 720 px).
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1280);
});

afterEach(() => {
  vi.useRealTimers();
  delete document.documentElement.dataset['reducedMotion'];
});

describe('PFC-004 — accueil et raccourcis', () => {
  it('affiche le titre, les quatre modes et le raccourci Espace', () => {
    renderStage();

    expect(screen.getByRole('heading', { level: 1, name: 'ELEM3NTS' })).toBeVisible();
    const nav = screen.getByRole('navigation', { name: 'Modes de jeu' });
    expect(within(nav).getAllByRole('button').map((node) => node.textContent)).toEqual([
      'Jouer en local',
      'Jouer en ligne',
      'Réglages',
      'Règles du jeu',
    ]);
    expect(screen.getByText('Espace')).toBeVisible();
  });

  it('Espace ouvre la préparation, puis lance la partie', () => {
    renderStage();

    space();
    expect(screen.getByRole('heading', { name: 'Préparer le duel' })).toHaveFocus();
    space();
    expect(screen.getByText('Que le duel commence')).toBeInTheDocument();
  });

  it('ignore Espace répété et laisse l’action native d’un bouton ciblé (pas de double déclenchement)', () => {
    renderStage();

    space({ repeat: true });
    expect(screen.queryByRole('heading', { name: 'Préparer le duel' })).not.toBeInTheDocument();

    button('Jouer en ligne').focus();
    space();
    expect(screen.queryByRole('heading', { name: 'Préparer le duel' })).not.toBeInTheDocument();
  });

  it('annonce par un toast les modes pas encore disponibles, puis le retire après 4 s', () => {
    vi.useFakeTimers();
    renderStage();

    fireEvent.click(button('Notes de conception'));
    expect(screen.getByRole('status')).toHaveTextContent('Les notes de conception arrivent bientôt.');
    fireEvent.click(button('Notes de conception'));
    expect(screen.getAllByText('Les notes de conception arrivent bientôt.')).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(4300);
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('ferme un toast à la demande, avec une sortie animée', () => {
    vi.useFakeTimers();
    renderStage();
    fireEvent.click(button('Notes de conception'));

    fireEvent.click(button('Fermer la notification'));
    expect(screen.getByText('Les notes de conception arrivent bientôt.').closest('.toast')).toHaveClass('toast--leaving');
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});

describe('PFC-004-AC1 — score cible', () => {
  it('PFC-004-S1 — X = 10 et nul OFF sont valides et affichés', () => {
    renderStage();
    toSetup();

    fireEvent.click(button('Score cible 10'));
    expect(screen.getByText('Premier à 10 points')).toBeVisible();
    expect(spinbutton()).toHaveAttribute('aria-valuenow', '10');
    expect(button('Score cible 10')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(button('Modifier les touches'));
    const draw = screen.getByRole('switch', { name: 'Match nul' });
    fireEvent.click(draw);
    expect(draw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(button('Fermer'));

    expect(screen.getByText('Premier à 10 points')).toBeVisible();
    expect(button(/^Commencer/)).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(button(/^Commencer/));
    expect(screen.getByText('Premier à 10 points')).toBeInTheDocument();
  });

  it('PFC-004-S2 — X = 11 affiche une erreur accessible et rend le lancement indisponible', () => {
    renderStage();
    toSetup();

    fireEvent.change(spinbutton(), { target: { value: '11' } });

    expect(screen.getByRole('alert')).toHaveTextContent('Le score cible doit être compris entre 1 et 10.');
    expect(spinbutton()).toHaveAttribute('aria-invalid', 'true');
    expect(spinbutton()).toHaveAccessibleDescription('Le score cible doit être compris entre 1 et 10.');
    expect(spinbutton()).toHaveValue('11');
    const start = button(/^Commencer/);
    expect(start).toHaveAttribute('aria-disabled', 'true');
    expect(start).toHaveAccessibleDescription('Lancement indisponible : corrigez le score cible.');

    fireEvent.click(start);
    expect(screen.getByRole('heading', { name: 'Préparer le duel' })).toBeInTheDocument();
    expect(spinbutton()).toHaveFocus();

    screen.getByRole('heading', { name: 'Préparer le duel' }).focus();
    space();
    expect(screen.queryByRole('heading', { name: 'Que le duel commence' })).not.toBeInTheDocument();
  });

  it.each([
    ['0', 'Le score cible doit être compris entre 1 et 10.'],
    ['', 'Indiquez un score cible entre 1 et 10.'],
    ['2.5', 'Le score cible doit être un nombre entier, de 1 à 10.'],
    ['abc', 'Saisissez un nombre entier entre 1 et 10.'],
  ])('refuse %j avec le message « %s »', (value, message) => {
    renderStage();
    toSetup();

    fireEvent.change(spinbutton(), { target: { value } });

    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(button(/^Commencer/)).toHaveAttribute('aria-disabled', 'true');
  });

  it('accepte 1 et 10 saisis au clavier, et les flèches, Début et Fin', () => {
    renderStage();
    toSetup();
    const input = spinbutton();

    fireEvent.change(input, { target: { value: '1' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Premier à 1 point')).toBeVisible();

    fireEvent.change(input, { target: { value: '10' } });
    expect(screen.getByText('Premier à 10 points')).toBeVisible();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveValue('9');
    fireEvent.keyDown(input, { key: 'Home' });
    expect(input).toHaveValue('1');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).toHaveValue('2');
    fireEvent.keyDown(input, { key: 'End' });
    expect(input).toHaveValue('10');
  });

  it('Échap dans le champ rétablit la dernière valeur valide', () => {
    renderStage();
    toSetup();

    fireEvent.change(spinbutton(), { target: { value: '42' } });
    fireEvent.keyDown(spinbutton(), { key: 'Escape' });

    expect(spinbutton()).toHaveValue('3');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Préparer le duel' })).toBeInTheDocument();
  });
});

describe('PFC-004-AC2 — règles, réglages et focus au clavier', () => {
  it('explique le cycle et les éléments identiques, puis rend le focus à l’accueil', () => {
    renderStage();
    fireEvent.click(button('Règles du jeu'));

    const dialog = screen.getByRole('dialog', { name: 'Règles du jeu' });
    expect(within(dialog).getByText('Les deux joueurs gagnent 1 point.')).toBeVisible();
    expect(within(dialog).getByText('Les deux joueurs perdent 1 point.')).toBeVisible();
    expect(within(dialog).getByText(/Le joueur au score le plus faible gagne 1 point/)).toBeVisible();
    expect(within(dialog).getByText(/Chaque manche laisse 5 secondes pour choisir/)).toBeVisible();

    escape();
    expect(button('Règles du jeu')).toHaveFocus();
  });

  it('Échap quitte la préparation et rend le focus à « Jouer en local »', () => {
    renderStage();
    toSetup();
    escape();
    expect(button('Jouer en local')).toHaveFocus();
  });

  it('le tiroir Réglages réaffecte une touche, signale conflits et touches réservées', () => {
    renderStage();
    fireEvent.click(button('Réglages'));
    const dialog = screen.getByRole('dialog', { name: 'Réglages' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Joueur 1, Feu : Q' }));
    expect(within(dialog).getByRole('button', { name: 'Joueur 1, Feu : en attente d’une touche' })).toHaveTextContent('Appuyez…');
    press('f', 'KeyF');
    expect(within(dialog).getByRole('button', { name: 'Joueur 1, Feu : F' })).toBeVisible();
    expect(within(dialog).getAllByRole('status')[0]).toHaveTextContent('« F » attribuée à Joueur 1 · Feu.');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Joueur 1, Eau : S' }));
    press('j', 'KeyJ');
    expect(dialog).toHaveTextContent('Conflit : « J » est déjà attribuée à Joueur 2 · Feu. Choisissez une autre touche.');
    press('Tab', 'Tab');
    expect(dialog).toHaveTextContent('« Tab » est réservée à la navigation au clavier. Choisissez une autre touche.');
    escape();
    expect(dialog).toHaveTextContent('Modification annulée.');
    expect(within(dialog).getByRole('button', { name: 'Joueur 1, Eau : S' })).toBeVisible();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Rétablir les touches par défaut' }));
    expect(within(dialog).getByRole('button', { name: 'Joueur 1, Feu : Q' })).toBeVisible();

    escape();
    expect(button('Réglages')).toHaveFocus();
  });

  it('pendant l’écoute, la touche n’atteint aucun autre écouteur (futures commandes de jeu)', () => {
    const other = vi.fn();
    window.addEventListener('keydown', other);
    try {
      renderStage();
      fireEvent.click(button('Réglages'));
      fireEvent.click(button('Joueur 1, Feu : Q'));
      press('f', 'KeyF');
      expect(other).not.toHaveBeenCalled();

      press('g', 'KeyG');
      expect(other).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', other);
    }
  });

  it('la nouvelle touche apparaît dans les légendes de la préparation', () => {
    renderStage();
    fireEvent.click(button('Réglages'));
    fireEvent.click(button('Joueur 2, Plante : L'));
    press('m', 'Semicolon');
    fireEvent.click(button('Fermer'));
    toSetup();

    expect(within(screen.getByRole('list', { name: 'Touches de Joueur 2' })).getByText('M')).toBeVisible();
  });

  it('applique « Mouvements réduits » à tout le document et choisit la qualité', () => {
    renderStage();
    fireEvent.click(button('Réglages'));

    fireEvent.click(screen.getByRole('switch', { name: 'Mouvements réduits' }));
    expect(document.documentElement.dataset['reducedMotion']).toBe('true');

    fireEvent.click(button('Basse'));
    expect(button('Basse')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Basse : sans ombres ni réfraction/)).toBeVisible();
  });
});

describe('PFC-004-AC3 — partie en cours', () => {
  it('fige les réglages : aucune commande de X ni du nul dans l’arène', () => {
    renderStage();
    toSetup();
    fireEvent.click(button('Score cible 7'));
    fireEvent.click(button(/^Commencer/));

    expect(screen.getByText('Premier à 7 points')).toBeInTheDocument();
    expect(screen.getByText('Manche 1 · premier à 7')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Score cible/ })).not.toBeInTheDocument();
  });

  it('la bannière s’efface après 1,8 s ; Échap annule la partie sans trophée', () => {
    vi.useFakeTimers();
    renderStage();
    toSetup();
    fireEvent.click(button(/^Commencer/));

    act(() => {
      vi.advanceTimersByTime(ARENA_BANNER_MS);
    });
    expect(document.querySelector('.arena__banner')).toHaveClass('arena__banner--hidden');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    escape();
    expect(button('Jouer en local')).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Partie annulée : aucun trophée attribué.');
  });
});

describe('PFC-004 — robustesse', () => {
  it('se monte et se démonte sous StrictMode sans laisser d’écouteur actif', () => {
    const { unmount } = renderStage();
    unmount();

    space();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});

/** Frappe sur une touche physique, avec le caractère produit par la disposition (AZERTY par défaut). */
const hit = (code: string, key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { code, key, ...init });

const statusOf = (player: 0 | 1) => document.querySelectorAll('.arena__status')[player] as HTMLElement;

function toSelecting() {
  vi.useFakeTimers();
  const view = renderStage();
  toSetup();
  fireEvent.click(button(/^Commencer/));
  act(() => {
    vi.advanceTimersByTime(ARENA_BANNER_MS);
  });
  act(() => {
    vi.advanceTimersByTime(SELECTION_DELAY_MS);
  });
  return view;
}

describe('PFC-005 — clavier partagé et choix masqués', () => {
  it('la sélection commence 0,4 s après la bannière : aucune frappe n’est retenue avant', () => {
    vi.useFakeTimers();
    renderStage();
    toSetup();
    fireEvent.click(button(/^Commencer/));
    act(() => {
      vi.advanceTimersByTime(ARENA_BANNER_MS);
    });
    expect(hit('KeyA', 'q')).toBe(true);
    expect(statusOf(0).textContent).toBe('');

    act(() => {
      vi.advanceTimersByTime(SELECTION_DELAY_MS);
    });
    expect(statusOf(0)).toHaveTextContent('Choix en cours…');
    expect(statusOf(1)).toHaveTextContent('Choix en cours…');
  });

  it('PFC-005-S1 — J1 KeyA puis J2 KeyL : deux verrous, aucun élément affiché', () => {
    toSelecting();

    hit('KeyA', 'q');
    expect(statusOf(0)).toHaveTextContent('Choix verrouillé');
    expect(screen.getByText('Joueur 1 a verrouillé son choix.')).toBeInTheDocument();
    expect(statusOf(1)).toHaveTextContent('Choix en cours…');
    hit('KeyL', 'l');
    expect(statusOf(1)).toHaveTextContent('Choix verrouillé');
    expect(screen.getByText('Joueur 1 et Joueur 2 ont verrouillé leur choix.')).toBeInTheDocument();
    expect(statusOf(0)).toHaveClass('arena__status--locked');

    // Hors légendes des touches, aucun nom ni identifiant d'élément dans le DOM.
    const main = screen.getByRole('main').cloneNode(true) as HTMLElement;
    for (const label of main.querySelectorAll('.arena__legend, .arena__trin')) label.remove();
    expect(main.innerHTML).not.toMatch(/feu|eau|plante|fire|water|plant/i);
  });

  it('PFC-005-S2 — KeyA puis KeyS : le premier choix reste, J2 n’est pas affecté', () => {
    toSelecting();

    hit('KeyA', 'q');
    const before = statusOf(0).innerHTML;
    expect(hit('KeyS', 's')).toBe(false);
    expect(statusOf(0).innerHTML).toBe(before);
    expect(statusOf(1)).toHaveTextContent('Choix en cours…');
  });

  it('ignore repeat, modificateurs et saisie dans un champ ; n’annule que les touches traitées', () => {
    toSelecting();
    expect(hit('KeyA', 'q', { repeat: true })).toBe(true);
    expect(hit('KeyA', 'q', { ctrlKey: true })).toBe(true);
    expect(hit('KeyQ', 'a')).toBe(true);

    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    try {
      expect(hit('KeyA', 'q')).toBe(true);
      expect(statusOf(0)).toHaveTextContent('Choix en cours…');
    } finally {
      field.remove();
    }
  });

  it('une lettre choisit même quand un bouton a le focus (aucune action native à doubler)', () => {
    toSelecting();
    button('Échap · Quitter').focus();

    expect(hit('KeyJ', 'j')).toBe(false);
    expect(statusOf(1)).toHaveTextContent('Choix verrouillé');
    expect(document.querySelector('.arena')).toBeInTheDocument();
  });

  it('corrige le libellé d’une touche d’après le caractère réellement produit', () => {
    toSelecting();
    const legend = screen.getByRole('list', { name: 'Touches de Joueur 1' });
    expect(legend).toHaveTextContent('Q');

    hit('KeyA', 'a');
    expect(within(legend).getByText('A')).toBeInTheDocument();
  });

  it('PFC-005-AC3 — Espace en arène ne relance rien et n’efface pas les choix', () => {
    toSelecting();
    hit('KeyA', 'q');
    space();
    space({ repeat: true });

    expect(statusOf(0)).toHaveTextContent('Choix verrouillé');
    expect(screen.getByText('Manche 1 · premier à 3')).toBeInTheDocument();
  });

  it('PFC-025 — sur téléphone, tour par tour : voile, choix au toucher, aucun élément avant la révélation', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
    vi.useFakeTimers();
    renderStage();
    fireEvent.click(button('Touchez pour jouer'));
    fireEvent.click(button(/^Commencer/));
    act(() => {
      vi.advanceTimersByTime(ARENA_BANNER_MS + SELECTION_DELAY_MS);
    });

    const gate1 = screen.getByRole('dialog', { name: 'Joueur 1, à vous' });
    expect(gate1).toHaveAccessibleDescription('Joueur 2 détourne les yeux. Vous aurez 5 secondes pour toucher un élément.');
    expect(within(gate1).getByText('Manche 1 · tour par tour')).toBeVisible();
    expect(button('Je suis prêt')).toHaveFocus();
    // Le clavier ne sélectionne pas en tour par tour.
    expect(hit('KeyA', 'q')).toBe(true);

    fireEvent.click(button('Je suis prêt'));
    expect(screen.getByText('Joueur 1 · touchez un élément')).toBeVisible();
    const picks = screen.getByRole('group', { name: 'Votre élément' });
    expect(within(picks).getAllByRole('button').map((node) => node.textContent)).toEqual(['Feu', 'Eau', 'Plante']);
    expect([...document.querySelectorAll('.arena-m__status')].map((node) => node.textContent)).toEqual(['Choix en cours…', 'En attente']);

    fireEvent.click(within(picks).getByRole('button', { name: 'Feu' }));
    const gate2 = screen.getByRole('dialog', { name: 'Passez le téléphone à Joueur 2' });
    expect(gate2).toHaveAccessibleDescription('Le choix de Joueur 1 est verrouillé et caché. Joueur 2 aura 5 secondes.');
    expect(button('Joueur 2 — je suis prêt')).toHaveFocus();
    // AC2 : le choix de Joueur 1 n'est nulle part dans le DOM avant la révélation.
    expect(document.body.innerHTML).not.toMatch(/Feu|fire/);
    expect([...document.querySelectorAll('.arena-m__status')].map((node) => node.textContent)).toEqual(['Choix verrouillé', 'En attente']);

    fireEvent.click(button('Joueur 2 — je suis prêt'));
    expect(screen.getByText('Joueur 2 · touchez un élément')).toBeVisible();
    fireEvent.click(within(screen.getByRole('group', { name: 'Votre élément' })).getByRole('button', { name: 'Eau' }));
    // Le choix de Joueur 2 déclenche aussitôt la révélation.
    expect(document.querySelector('.arena')).toHaveAttribute('data-phase', 'reveal');
    expect([...document.querySelectorAll('.arena-m__status')].map((node) => node.textContent)).toEqual(['Feu', 'Eau']);
  });

  it('PFC-005-AC3 — retire tous ses écouteurs clavier au démontage (StrictMode)', () => {
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const { unmount } = toSelecting();
    unmount();

    const count = (spy: typeof added) => spy.mock.calls.filter(([type]) => type === 'keydown').length;
    expect(count(added)).toBeGreaterThan(0);
    expect(count(removed)).toBe(count(added));
  });
});

describe('PFC-005 — disposition affichée sans Keyboard Layout API', () => {
  it('propose AZERTY/QWERTY quand l’API manque ; QWERTY affiche A/S/D', () => {
    renderStage();
    fireEvent.click(button('Réglages'));
    const group = screen.getByRole('group', { name: 'Disposition affichée' });
    expect(within(group).getByRole('button', { name: 'AZERTY' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(group).getByRole('button', { name: 'QWERTY' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Libellés des touches affichés en QWERTY.');
    expect(button('Joueur 1, Feu : A')).toBeVisible();
    fireEvent.click(button('Fermer'));
    toSetup();
    expect(screen.getByRole('list', { name: 'Touches de Joueur 1' })).toHaveTextContent('AFeuSEauDPlante');
  });

  it('propose le choix si l’API renvoie une table vide (Chromium sans session graphique)', async () => {
    Object.defineProperty(navigator, 'keyboard', {
      configurable: true,
      value: { getLayoutMap: () => Promise.resolve(new Map()) },
    });
    try {
      renderStage();
      fireEvent.click(button('Réglages'));
      expect(await screen.findByRole('group', { name: 'Disposition affichée' })).toBeVisible();
    } finally {
      Reflect.deleteProperty(navigator, 'keyboard');
    }
  });

  it('n’affiche pas le choix quand le navigateur fournit la disposition réelle', async () => {
    Object.defineProperty(navigator, 'keyboard', {
      configurable: true,
      value: { getLayoutMap: () => Promise.resolve(new Map([['KeyA', 'q']])) },
    });
    try {
      renderStage();
      fireEvent.click(button('Réglages'));
      expect(await screen.findByRole('button', { name: 'Joueur 1, Feu : Q' })).toBeVisible();
      expect(screen.queryByRole('group', { name: 'Disposition affichée' })).not.toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(navigator, 'keyboard');
    }
  });
});

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const banner = (): HTMLElement => {
  const node = document.querySelector<HTMLElement>('.arena__banner');
  if (!node) throw new Error('Bannière de l’arène absente.');
  return node;
};
const timerNumber = () => screen.getByRole('timer', { hidden: true });

describe('PFC-006 — cycle local', () => {
  it('PFC-006-S1 — deux choix à t=1000 : révélation à 5000 seulement, résolution unique, manche 2', () => {
    toSelecting();
    expect(timerNumber()).toHaveTextContent('5');

    advance(1000);
    hit('KeyA', 'q');
    hit('KeyL', 'l');
    // Chiffre en or vif à partir de 1,5 s restante (maquette), pas avant.
    advance(2400);
    expect(timerNumber()).toHaveTextContent('2');
    expect(timerNumber()).not.toHaveClass('round-timer__number--urgent');
    advance(100);
    expect(timerNumber()).toHaveClass('round-timer__number--urgent');
    advance(1499);
    expect(statusOf(0)).toHaveTextContent('Choix verrouillé');
    expect(statusOf(1)).toHaveTextContent('Choix verrouillé');
    expect(timerNumber()).toHaveTextContent('1');
    expect(timerNumber()).toHaveClass('round-timer__number--urgent');

    advance(1);
    expect(statusOf(0)).toHaveTextContent('Feu');
    expect(statusOf(1)).toHaveTextContent('Plante');
    expect(statusOf(0)).toHaveClass('arena__status--fire');
    // Scores d'avant la manche pendant la révélation (maquette).
    expect([...document.querySelectorAll('.arena__score')].map((node) => node.textContent)).toEqual(['0', '0']);

    // Début de la chorégraphie (1,1 s) : encore les éléments et les scores d'avant, pas d'explication.
    advance(CYCLE_MS.reveal);
    expect(statusOf(1)).toHaveTextContent('Plante');
    expect(banner()).toHaveClass('arena__banner--hidden');
    expect(document.querySelector('.arena__player--p1 .arena__score')).toHaveTextContent('0');

    // Impact de « burn » : 47 % de 3,6 s après le début de l'effet.
    advance(clashDelays('burn').toImpact - 1);
    expect(document.querySelector('.arena__player--p1 .arena__score')).toHaveTextContent('0');
    advance(1);
    expect(banner()).toHaveTextContent('Le Feu consume la Plante+1 pour Joueur 1');
    expect(document.querySelector('.arena__player--p1 .arena__score')).toHaveTextContent('1');
    expect(document.querySelector('.arena__player--p1 .arena__delta')).toHaveTextContent('+1');
    expect(document.querySelector('.arena__player--p2 .arena__delta')).toHaveTextContent('±0');
    expect(
      screen.getByText('Joueur 1 : Feu, Joueur 2 : Plante. Le Feu consume la Plante — +1 pour Joueur 1. Score 1 à 0.'),
    ).toBeInTheDocument();

    advance(clashDelays('burn').afterImpact);
    expect(banner()).toHaveClass('arena__banner--hidden');
    advance(CYCLE_MS.pause);
    expect(screen.getByText('Manche 2 · premier à 3')).toBeInTheDocument();
    expect(statusOf(0)).toHaveTextContent('Choix en cours…');
    expect(document.querySelector('.arena__player--p1 .arena__score')).toHaveTextContent('1');
  });

  it('PFC-006-S2 — seul J1 choisit : « Temps écoulé », +1 pour Joueur 1 (R11)', () => {
    toSelecting();
    hit('KeyA', 'q');
    advance(CYCLE_MS.selection);
    expect(statusOf(1)).toHaveTextContent('Aucun choix');
    advance(CYCLE_MS.reveal);
    advance(clashDelays('solo').toImpact);
    expect(banner()).toHaveTextContent('Temps écouléSeul choix de la manche : point pour Joueur 1');
  });

  it('PFC-006-AC2 — aucune saisie hors sélection : un choix pendant la révélation est ignoré', () => {
    toSelecting();
    advance(CYCLE_MS.selection);
    expect(hit('KeyA', 'q')).toBe(true);
    advance(CYCLE_MS.revealEmpty);
    advance(clashDelays('void').toImpact);
    expect(banner()).toHaveTextContent('Temps écouléAucun choix — la manche est annulée');
    expect(statusOf(0)).toHaveTextContent('Aucun choix');
  });

  it('PFC-006-AC3 — démontage en pleine manche : plus aucune minuterie ni échéance', () => {
    const errors = vi.spyOn(console, 'error');
    const { unmount } = toSelecting();
    hit('KeyA', 'q');
    unmount();

    expect(vi.getTimerCount()).toBe(0);
    advance(60_000);
    expect(errors).not.toHaveBeenCalled();
  });

  it('PFC-006-AC3 — retour sur un onglet masqué : l’échéance dépassée est traitée une seule fois', () => {
    toSelecting();
    const late = performance.now() + CYCLE_MS.selection + 10;
    vi.spyOn(performance, 'now').mockReturnValue(late);

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(statusOf(0)).toHaveTextContent('Aucun choix');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(banner()).toHaveClass('arena__banner--hidden');
  });
});

/** Joue une manche décisive à X = 1 depuis l'ouverture de l'arène : touches physiques des deux joueurs. */
function playDecisiveRound(keys: readonly (readonly [string, string])[]) {
  advance(CYCLE_MS.banner);
  advance(CYCLE_MS.ready);
  for (const [code, key] of keys) hit(code, key);
  advance(CYCLE_MS.selection);
  advance(CYCLE_MS.reveal);
  // Une phase par pas : l'échéance suivante est posée au rendu. Pas assez longs pour tout effet.
  advance(3000);
  advance(4000);
  advance(CYCLE_MS.closing);
}

const J1_WINS = [
  ['KeyA', 'q'],
  ['KeyL', 'l'],
] as const;
const J2_WINS = [
  ['KeyD', 'd'],
  ['KeyJ', 'j'],
] as const;
const DRAW = [
  ['KeyA', 'q'],
  ['KeyJ', 'j'],
] as const;

const trophies = () =>
  within(screen.getByRole('group', { name: 'Trophées de la session' }))
    .getAllByText(/^\d+$/)
    .map((node) => node.textContent);

function startLocalAtOne() {
  toSetup();
  fireEvent.click(button('Score cible 1'));
  fireEvent.click(button(/^Commencer/));
}

describe('PFC-007 — fin de partie, revanche et session', () => {
  it('PFC-007-AC1 — victoire de J1 : texte de la maquette, scores et trophée de la session', () => {
    vi.useFakeTimers();
    renderStage();
    startLocalAtOne();
    playDecisiveRound(J1_WINS);

    expect(screen.getByRole('heading', { name: 'Victoire' })).toHaveFocus();
    expect(screen.getByText('Joueur 1 remporte la partie')).toBeVisible();
    expect(within(screen.getByRole('group', { name: 'Score final' })).getAllByText(/^[01]$/).map((n) => n.textContent)).toEqual([
      '1',
      '0',
    ]);
    expect(trophies()).toEqual(['1', '0']);
    expect(screen.getByRole('group', { name: 'Trophées de la session' })).toHaveTextContent('Joueur 1 : 1+1 (gagné cette partie)Joueur 2 : 0');
  });

  it('PFC-007-AC1 — victoire de J2 et match nul : textes et trophées exacts', () => {
    vi.useFakeTimers();
    renderStage();
    startLocalAtOne();
    playDecisiveRound(J2_WINS);
    expect(screen.getByRole('heading', { name: 'Victoire' })).toBeInTheDocument();
    expect(screen.getByText('Joueur 2 remporte la partie')).toBeVisible();
    expect(trophies()).toEqual(['0', '1']);

    space();
    playDecisiveRound(DRAW);
    expect(screen.getByRole('heading', { name: 'Match nul' })).toBeInTheDocument();
    expect(screen.getByText('Les deux joueurs atteignent la cible ensemble')).toBeVisible();
    expect(trophies()).toEqual(['1', '2']);
  });

  it('PFC-007-S1 — J1 a 2 trophées : Espace relance à 0/0, trophées conservés puis cumulés', () => {
    vi.useFakeTimers();
    renderStage();
    startLocalAtOne();
    playDecisiveRound(J1_WINS);
    space();
    playDecisiveRound(J1_WINS);
    expect(trophies()).toEqual(['2', '0']);

    space();
    expect(screen.getByText('Que le duel commence')).toBeInTheDocument();
    expect([...document.querySelectorAll('.arena__score')].map((node) => node.textContent)).toEqual(['0', '0']);
    expect(screen.getByText('Manche 1 · premier à 1')).toBeInTheDocument();

    playDecisiveRound(J2_WINS);
    expect(trophies()).toEqual(['2', '1']);
  });

  it('PFC-007-AC2 — Espace maintenu ou doublé : une seule revanche', () => {
    vi.useFakeTimers();
    renderStage();
    startLocalAtOne();
    playDecisiveRound(J1_WINS);

    space();
    space({ repeat: true });
    space();
    playDecisiveRound(J1_WINS);
    // Une seule nouvelle partie a été jouée : un seul trophée de plus.
    expect(trophies()).toEqual(['2', '0']);
  });

  it('« Rejouer » au bouton : Espace sur le bouton ciblé ne déclenche pas une seconde revanche', () => {
    vi.useFakeTimers();
    renderStage();
    startLocalAtOne();
    playDecisiveRound(J1_WINS);

    const replay = button('Rejouer');
    replay.focus();
    space();
    expect(screen.getByRole('heading', { name: 'Victoire' })).toBeInTheDocument();
    fireEvent.click(replay);
    expect(screen.getByText('Que le duel commence')).toBeInTheDocument();
  });

  it('PFC-007-S2 — retour à l’accueil puis nouveau local : trophées remis à 0/0', () => {
    vi.useFakeTimers();
    renderStage();
    startLocalAtOne();
    playDecisiveRound(J1_WINS);
    space();
    playDecisiveRound(J1_WINS);
    expect(trophies()).toEqual(['2', '0']);

    escape();
    expect(button('Jouer en local')).toHaveFocus();
    expect(screen.queryByText('Partie annulée : aucun trophée attribué.')).not.toBeInTheDocument();
    startLocalAtOne();
    playDecisiveRound(J2_WINS);
    expect(trophies()).toEqual(['0', '1']);
  });

  it('la revanche garde les réglages de la partie terminée (X, nul)', () => {
    vi.useFakeTimers();
    renderStage();
    startLocalAtOne();
    playDecisiveRound(DRAW);
    expect(screen.getByRole('heading', { name: 'Match nul' })).toBeInTheDocument();

    fireEvent.click(button('Rejouer'));
    expect(screen.getByText('Premier à 1 point')).toBeInTheDocument();
    playDecisiveRound(DRAW);
    expect(screen.getByRole('heading', { name: 'Match nul' })).toBeInTheDocument();
    expect(trophies()).toEqual(['2', '2']);
  });
});

describe('PFC-008-AC2 — repli sans 3D annoncé une seule fois', () => {
  function WithScene({ scene }: { readonly scene: SceneState }) {
    return (
      <SceneContext.Provider value={scene}>
        <Stage />
      </SceneContext.Provider>
    );
  }

  it('annonce la cause, une seule fois même si la scène change encore d’état', () => {
    const view = render(<WithScene scene={SCENE_LOADING} />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    view.rerender(<WithScene scene={sceneFallback('lost')} />);
    expect(screen.getByRole('status')).toHaveTextContent('Scène 3D interrompue : la partie continue sans effets.');
    view.rerender(<WithScene scene={sceneFallback('slow')} />);
    expect(screen.queryByText(/trop lente/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Scène 3D/)).toHaveLength(1);
  });

  it.each([
    ['unsupported', 'Scène 3D indisponible sur cet appareil : la partie se joue sans effets.'],
    ['failed', 'Scène 3D non chargée : la partie se joue sans effets.'],
    ['slow', 'Scène 3D trop lente sur cet appareil : la partie se joue sans effets.'],
  ] as const)('cause %s : « %s »', (reason, message) => {
    render(<WithScene scene={sceneFallback(reason)} />);
    expect(screen.getByRole('status')).toHaveTextContent(message);
  });
});

describe('PFC-021 — parcours clavier et focus', () => {
  it('Espace sur l’accueil ouvre une nouvelle session, comme « Jouer en local » (D13)', () => {
    vi.useFakeTimers();
    renderStage();
    startLocalAtOne();
    playDecisiveRound(J1_WINS);
    expect(trophies()).toEqual(['1', '0']);

    escape();
    (document.activeElement as HTMLElement).blur();
    space();
    expect(screen.getByRole('heading', { name: 'Préparer le duel' })).toHaveFocus();
    fireEvent.click(button('Score cible 1'));
    fireEvent.click(button(/^Commencer/));
    playDecisiveRound(J2_WINS);
    expect(trophies()).toEqual(['0', '1']);
  });

  it('fermer les réglages ouverts depuis la préparation rend le focus à « Modifier les touches »', () => {
    renderStage();
    toSetup();
    fireEvent.click(button('Modifier les touches'));
    expect(screen.getByRole('dialog', { name: 'Réglages' })).toBeInTheDocument();

    escape();
    expect(button('Modifier les touches')).toHaveFocus();
    // Retour à l'accueil puis nouvelle préparation : le titre reprend le focus.
    escape();
    toSetup();
  });

  it('le verdict focalisé porte le nom du vainqueur en description', () => {
    vi.useFakeTimers();
    renderStage();
    startLocalAtOne();
    playDecisiveRound(J2_WINS);

    const verdict = screen.getByRole('heading', { name: 'Victoire' });
    expect(verdict).toHaveFocus();
    expect(verdict).toHaveAccessibleDescription('Joueur 2 remporte la partie');
  });

  it('fermer au clavier une notification rend le focus à son origine, jamais au <body>', () => {
    renderStage();
    const origin = button('Notes de conception');
    fireEvent.click(origin);
    origin.focus();

    const close = button('Fermer la notification');
    act(() => {
      close.focus();
    });
    fireEvent.click(close);
    expect(origin).toHaveFocus();
  });
});

describe('PFC-026 — démo des confrontations', () => {
  const runButton = (name: string) => within(screen.getByRole('group', { name: 'Confrontations' })).getByRole('button', { name });
  const scores = () => [...document.querySelectorAll('.arena__score')].map((node) => node.textContent);
  const statuses = () => [statusOf(0).textContent, statusOf(1).textContent];

  function openDemo() {
    fireEvent.click(button('Démo des confrontations'));
    expect(screen.getByRole('heading', { name: 'Démo des confrontations' })).toHaveFocus();
    expect(screen.getByRole('region', { name: 'Démo · rejouer chaque confrontation' })).toBeInTheDocument();
  }

  it('ouvre la démo (plus de toast) : neuf confrontations, vainqueur à gauche, 0/0 au repos', () => {
    renderStage();
    openDemo();

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(within(screen.getByRole('group', { name: 'Confrontations' })).getAllByRole('button')).toHaveLength(9);
    expect(button('À gauche')).toHaveAttribute('aria-pressed', 'true');
    expect(button('À droite')).toHaveAttribute('aria-pressed', 'false');
    expect(scores()).toEqual(['0', '0']);
    expect(statuses()).toEqual(['', '']);
    // Pas de « Quitter » dans la démo (maquette) : « Accueil » et Échap en tiennent lieu.
    expect(screen.queryByRole('button', { name: 'Échap · Quitter' })).not.toBeInTheDocument();
  });

  it('PFC-026-S1 et S2 — Eau + Eau : verrous, révélation, 2/2 → 1/1 ; une autre confrontation est ignorée pendant l’effet', () => {
    vi.useFakeTimers();
    renderStage();
    openDemo();

    const siphon = runButton('Eau + Eau');
    siphon.focus();
    fireEvent.click(siphon);
    expect(scores()).toEqual(['2', '2']);
    expect(statuses()).toEqual(['Choix verrouillé', 'Choix verrouillé']);
    expect(runButton('Feu + Feu')).toHaveAttribute('aria-disabled', 'true');

    advance(700);
    expect(statuses()).toEqual(['Eau', 'Eau']);
    fireEvent.click(runButton('Feu + Feu'));
    expect(statuses()).toEqual(['Eau', 'Eau']);

    advance(CYCLE_MS.reveal);
    expect(banner()).toHaveClass('arena__banner--hidden');
    advance(clashDelays('siphon').toImpact);
    expect(banner()).toHaveTextContent('La mer engloutit tout−1 pour les 2 joueurs');
    expect(scores()).toEqual(['1', '1']);
    expect(screen.getAllByText('−1')).toHaveLength(2);
    expect(screen.getByText(/^Joueur 1 : Eau, Joueur 2 : Eau\. La mer engloutit tout/)).toBeInTheDocument();

    advance(clashDelays('siphon').afterImpact);
    expect(banner()).toHaveClass('arena__banner--hidden');
    expect(scores()).toEqual(['1', '1']);
    expect(statuses()).toEqual(['', '']);
    expect(runButton('Feu + Feu')).toHaveAttribute('aria-disabled', 'false');
    // Le bouton cliqué a gardé le focus pendant tout l'effet.
    expect(siphon).toHaveFocus();
    // Aucune manche suivante : l'état de repos se maintient.
    advance(60_000);
    expect(statuses()).toEqual(['', '']);
  });

  it('vainqueur à droite : Eau › Feu donne le point à Joueur 2', () => {
    vi.useFakeTimers();
    renderStage();
    openDemo();
    fireEvent.click(button('À droite'));
    expect(button('À droite')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(runButton('Eau › Feu'));
    advance(700);
    expect(statuses()).toEqual(['Feu', 'Eau']);
    advance(CYCLE_MS.reveal);
    advance(clashDelays('wave').toImpact);
    expect(banner()).toHaveTextContent('L’Eau éteint le Feu+1 pour Joueur 2');
    expect(scores()).toEqual(['2', '3']);
  });

  it('PFC-026-AC2 — Échap et « Accueil » ramènent à l’accueil, focus sur la démo ; aucun trophée ni session modifiés', () => {
    vi.useFakeTimers();
    renderStage();
    openDemo();
    fireEvent.click(runButton('Feu + Feu'));
    advance(700);
    escape();
    expect(button('Démo des confrontations')).toHaveFocus();

    openDemo();
    fireEvent.click(button('Accueil'));
    expect(button('Démo des confrontations')).toHaveFocus();

    // Une partie jouée ensuite ne compte qu'elle-même.
    startLocalAtOne();
    playDecisiveRound(J1_WINS);
    expect(trophies()).toEqual(['1', '0']);
  });

  it('pilote seule la scène : mêmes commandes que la partie, puis accueil rendu à la scène de l’application', () => {
    vi.useFakeTimers();
    const engine = {
      setScene: vi.fn(),
      setLock: vi.fn(),
      reveal: vi.fn(),
      clash: vi.fn(),
      reset: vi.fn(),
      celebrate: vi.fn(),
      setQuality: vi.fn(),
      setReduced: vi.fn(),
      setMobile: vi.fn(),
    };
    const scene = { status: 'ready', reason: null, engine: engine as unknown as Engine, trinity: [] } as const satisfies SceneState;
    render(
      <SceneContext.Provider value={scene}>
        <Stage />
      </SceneContext.Provider>,
    );
    openDemo();
    expect(engine.setScene).toHaveBeenLastCalledWith('arena');

    fireEvent.click(runButton('Plante › Eau'));
    expect(engine.reveal).not.toHaveBeenCalled();
    advance(700);
    expect(engine.reveal).toHaveBeenCalledWith('plant', 'water');
    advance(CYCLE_MS.reveal);
    expect(engine.clash).toHaveBeenCalledTimes(1);
    expect(engine.clash).toHaveBeenCalledWith('grow', 0);

    escape();
    expect(engine.setScene).toHaveBeenLastCalledWith('home');
  });
});
