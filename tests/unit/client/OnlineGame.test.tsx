import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stage from '../../../src/client/Stage.tsx';
import { PING_INTERVAL_MS } from '../../../src/client/online/connection.ts';
import { defaultPreferences, updatePreferences } from '../../../src/client/state/preferences.ts';
import { CYCLE_MS, clashDelays, roundResultMs } from '../../../src/shared/cycle.ts';
import { playRound, startMatch, type Choices, type MatchSettings, type PlayerIndex } from '../../../src/domain/index.ts';
import { encodeServerMessage, pongMessage, type RoomView } from '../../../src/shared/protocol/index.ts';
import { FakeSocket, ackFrame, entryResponse, errorFrame, stateFrame } from './onlineFakes.ts';

/**
 * PFC-016 — partie en ligne dans l'application complète (`Stage`), serveur joué par une socket
 * factice : saisie de sa place, décompte, révélation, résultats, trophées et revanche. Les trames
 * sont construites par la vraie projection du serveur (`projectState`).
 */

/** Décalage entre l'horloge (factice) du serveur et celle de la page. */
const OFFSET = 100_000;
const serverNow = () => performance.now() + OFFSET;
const X3: MatchSettings = { target: 3, drawEnabled: true };
const X1: MatchSettings = { target: 1, drawEnabled: true };

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let socket: FakeSocket;
let revision = 10;

beforeEach(() => {
  localStorage.clear();
  updatePreferences(defaultPreferences());
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1280);
  FakeSocket.reset();
  vi.stubGlobal('WebSocket', FakeSocket);
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  revision = 10;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Trame suivante du serveur (révision croissante), datée sur l'horloge du serveur. */
function send(slot: PlayerIndex, overrides: Partial<RoomView>) {
  revision += 1;
  const frame = stateFrame(slot, { revision, ...overrides }, serverNow());
  act(() => {
    socket.receive(frame);
  });
}

/** Place réservée, socket ouverte, lobby reçu ; horloge factice ensuite. */
async function joined(slot: PlayerIndex): Promise<void> {
  fetchMock.mockResolvedValueOnce(entryResponse(slot));
  render(
    <StrictMode>
      <Stage />
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Jouer en ligne' }));
  if (slot === 0) {
    fireEvent.click(screen.getByRole('button', { name: /^Créer une partie/ }));
    await screen.findByText('Code de la partie');
  } else {
    fireEvent.click(screen.getByRole('button', { name: /^Rejoindre une partie/ }));
    fireEvent.change(screen.getByLabelText('Code reçu'), { target: { value: 'k7m2q9xa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rejoindre' }));
    await screen.findByRole('heading', { name: 'Connexion…' });
  }
  socket = FakeSocket.last();
  act(() => {
    socket.open();
  });
  vi.useFakeTimers();
  send(slot, { phase: 'lobby' });
}

const selecting = (overrides: Partial<RoomView> = {}): Partial<RoomView> => ({
  phase: 'selecting',
  match: startMatch('m-5', X3),
  roundId: 1,
  deadline: serverNow() + CYCLE_MS.selection,
  ...overrides,
});

/** Manche résolue par le vrai moteur, avec l'échéance de résultat que le serveur publierait. */
function roundResult(choices: Choices, settings: MatchSettings = X3): Partial<RoomView> {
  const play = playRound(startMatch('m-5', settings), choices);
  const followUp = play.match.result.status === 'playing' ? 'next' : 'end';
  return {
    phase: 'round-result',
    settings,
    match: play.match,
    roundId: 1,
    selection: choices,
    lastRound: { roundId: 1, choices, resolution: play.round },
    deadline: serverNow() + roundResultMs(play.round.kind, followUp),
  };
}

/** Partie terminée : J1 gagne 1-0 (X = 1), trophée réglé. */
function matchEnded(overrides: Partial<RoomView> = {}): Partial<RoomView> {
  const play = playRound(startMatch('m-5', X1), ['fire', 'plant']);
  return {
    phase: 'match-ended',
    settings: X1,
    match: play.match,
    roundId: 1,
    lastRound: { roundId: 1, choices: ['fire', 'plant'], resolution: play.round },
    trophies: [1, 0],
    ...overrides,
  };
}

const key = (code: string, value: string) => {
  fireEvent.keyDown(document.body, { code, key: value });
};
const statuses = () => [...document.querySelectorAll('.arena__status')].map((node) => node.textContent);
const scores = () => [...document.querySelectorAll('.arena__score')].map((node) => node.textContent);
const phase = () => document.querySelector('.arena')?.getAttribute('data-phase');
const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe('PFC-016 — saisie de sa place', () => {
  it('PFC-016-S1 — J2 presse KeyA en sélection : feu est soumis pour J2, sans place désignée', async () => {
    await joined(1);
    send(1, selecting());
    expect(screen.getByRole('heading', { name: 'Arène · manche 1 · premier à 3' })).toHaveFocus();
    expect(statuses()).toEqual(['Choix en cours…', 'Réfléchit…']);

    key('KeyA', 'q');

    expect(socket.sent.filter((frame) => frame['type'] === 'submit-choice')).toEqual([
      { v: 1, type: 'submit-choice', requestId: expect.stringMatching(/^[A-Za-z0-9_-]+$/) as unknown, matchId: 'm-5', roundId: 1, payload: { element: 'fire' } },
    ]);
    expect(statuses()).toEqual(['Choix verrouillé · Feu', 'Réfléchit…']);

    // Premier choix verrouillé ; les touches de Joueur 2 ne servent pas en ligne (SPEC saisie).
    key('KeyS', 's');
    key('KeyJ', 'j');
    expect(socket.sent.filter((frame) => frame['type'] === 'submit-choice')).toHaveLength(1);

    // Vérité du serveur : verrou de J2 publié, élément jamais.
    send(1, selecting({ selection: [null, 'fire'] }));
    expect(statuses()).toEqual(['Choix verrouillé · Feu', 'Réfléchit…']);
  });

  it('PFC-016-AC1 — l’adversaire verrouille : « Choix verrouillé », jamais son élément', async () => {
    await joined(0);
    send(0, selecting({ selection: [null, 'plant'] }));
    expect(statuses()).toEqual(['Choix en cours…', 'Choix verrouillé']);
    const hud = document.querySelector('.arena__player--p2');
    expect(hud?.textContent).not.toMatch(/Plante|Feu|Eau/);
    expect(screen.getByText('Joueur 2 a verrouillé son choix.')).toBeInTheDocument();
  });

  it('sans scène 3D : boutons Feu, Eau, Plante ; le choix est marqué, les autres désactivés', async () => {
    await joined(0);
    send(0, selecting());
    const group = screen.getByRole('group', { name: 'Votre élément' });
    fireEvent.click(within(group).getByRole('button', { name: /Eau/ }));
    expect(socket.lastSent('submit-choice')).toMatchObject({ payload: { element: 'water' } });
    expect(within(group).getByRole('button', { name: /Eau/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: /Feu/ })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(within(group).getByRole('button', { name: /Feu/ }));
    expect(socket.sent.filter((frame) => frame['type'] === 'submit-choice')).toHaveLength(1);
  });

  it('choix arrivé après l’échéance : refus explicite, le choix affiché est retiré', async () => {
    await joined(0);
    send(0, selecting());
    key('KeyA', 'q');
    const requestId = String(socket.lastSent('submit-choice')?.['requestId']);
    send(0, roundResult([null, 'water']));
    act(() => {
      socket.receive(errorFrame('INVALID_PHASE', requestId));
    });
    expect(screen.getByText('Choix arrivé trop tard : la manche était déjà close.')).toBeInTheDocument();
    expect(statuses()).toEqual(['Aucun choix', 'Eau']);
  });
});

describe('PFC-016 — vérité du serveur et horloge locale', () => {
  it('PFC-016-AC2 — le décompte atteint zéro sans rien révéler : seule la trame du serveur révèle', async () => {
    await joined(0);
    send(0, selecting());
    expect(screen.getByRole('timer')).toHaveTextContent('5');
    advance(CYCLE_MS.selection + 30_000);
    expect(phase()).toBe('selecting');
    expect(screen.getByRole('timer')).toHaveTextContent('0');
    expect(statuses()).toEqual(['Choix en cours…', 'Réfléchit…']);
    expect(scores()).toEqual(['0', '0']);

    send(0, roundResult(['fire', 'plant']));
    expect(phase()).toBe('reveal');
    expect(statuses()).toEqual(['Feu', 'Plante']);
  });

  it('PFC-016-AC2 — un état retardé (révision plus ancienne) ne fait pas régresser l’arène', async () => {
    await joined(0);
    send(0, roundResult(['fire', 'plant']));
    const late = stateFrame(0, { revision: revision - 1, ...selecting() }, serverNow());
    act(() => {
      socket.receive(late);
    });
    expect(phase()).toBe('reveal');
    expect(statuses()).toEqual(['Feu', 'Plante']);
  });

  it('chronologie du résultat : scores d’avant, puis impact, points et explication de son côté', async () => {
    await joined(1);
    send(1, roundResult(['fire', 'water']));
    expect(phase()).toBe('reveal');
    expect(scores()).toEqual(['0', '0']);
    advance(CYCLE_MS.reveal);
    expect(phase()).toBe('clash');
    expect(scores()).toEqual(['0', '0']);
    advance(clashDelays('wave').toImpact);
    expect(phase()).toBe('result');
    expect(scores()).toEqual(['1', '0']);
    expect(document.querySelector('.arena__banner-sub')).toHaveTextContent('+1 pour Vous');
    expect(screen.getByText(/Vous : Eau, Joueur 1 : Feu\. L’Eau éteint le Feu — \+1 pour Vous\. Score 1 à 0\./)).toBeInTheDocument();
    advance(clashDelays('wave').afterImpact);
    expect(phase()).toBe('pause');
  });

  it('latence mesurée par ping/pong, affichée comme dans la maquette', async () => {
    await joined(0);
    send(0, selecting());
    expect(screen.getByText('En ligne')).toBeInTheDocument();
    act(() => {
      socket.receive(ackFrame(String(socket.sent[0]?.['requestId'])));
    });
    const ping = socket.lastSent('ping');
    expect(ping).toMatchObject({ type: 'ping', payload: {} });
    advance(38);
    act(() => {
      socket.receive(encodeServerMessage(pongMessage(String(ping?.['requestId']), serverNow())));
    });
    expect(screen.getByText('En ligne · 38 ms')).toBeInTheDocument();
    advance(PING_INTERVAL_MS);
    expect(socket.sent.filter((frame) => frame['type'] === 'ping')).toHaveLength(2);
  });

  it('adversaire déconnecté en cours de partie : signalé, sans rien décider', async () => {
    await joined(0);
    send(0, selecting());
    send(0, selecting({ connected: [true, false] }));
    expect(screen.getByText('Joueur 2 s’est déconnecté.')).toBeInTheDocument();
    expect(screen.getByText('Joueur 2 déconnecté')).toBeInTheDocument();
    expect(phase()).toBe('selecting');
  });
});

describe('PFC-016 — fin de partie et revanche', () => {
  it('PFC-016-S2 / AC3 — seul J1 confirme : les deux restent en attente, sans remise à zéro', async () => {
    await joined(0);
    send(0, matchEnded());
    expect(screen.getByRole('heading', { name: 'Victoire' })).toHaveFocus();
    expect(screen.getByText('Vous remportez la partie')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Score final' })).toHaveTextContent('Vous1Joueur 20');

    key('Space', ' ');
    expect(socket.sent.filter((frame) => frame['type'] === 'rematch-ready')).toEqual([
      { v: 1, type: 'rematch-ready', requestId: expect.any(String) as unknown, matchId: 'm-5', payload: { expectedSettingsRevision: 0 } },
    ]);
    expect(screen.getByRole('button', { name: 'Rejouer' })).toHaveAttribute('aria-busy', 'true');

    send(0, matchEnded({ ready: [true, false] }));
    expect(screen.getByRole('button', { name: 'En attente de Joueur 2…' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('heading', { name: 'Victoire' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Score final' })).toHaveTextContent('Vous1Joueur 20');
    key('Space', ' ');
    expect(socket.sent.filter((frame) => frame['type'] === 'rematch-ready')).toHaveLength(1);

    // Deux confirmations : nouveau matchId, scores à zéro ; trophées conservés côté serveur.
    send(0, { phase: 'starting', settings: X1, match: startMatch('m-40', X1), roundId: 1, trophies: [1, 0], deadline: serverNow() + 2_200 });
    expect(document.querySelector('[data-match-id="m-40"]')).not.toBeNull();
    expect(scores()).toEqual(['0', '0']);
    expect(screen.getByText('Que le duel commence')).toBeInTheDocument();
  });

  it('PFC-016-S2 — vue de J2 : défaite, trophée de l’adversaire, et sa demande de revanche annoncée', async () => {
    await joined(1);
    send(1, matchEnded());
    expect(screen.getByRole('heading', { name: 'Défaite' })).toBeInTheDocument();
    expect(screen.getByText('Joueur 1 remporte la partie')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Trophées de la session' })).toHaveTextContent('Vous : 0Joueur 1 : 1+1 (gagné cette partie)');

    send(1, matchEnded({ ready: [true, false] }));
    expect(screen.getAllByText('Joueur 1 veut rejouer.').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Rejouer' })).not.toHaveAttribute('aria-disabled');
  });

  it('SPEC revanche — l’hôte change X en fin de partie : confirmations retirées, J2 prévenu', async () => {
    await joined(0);
    send(0, matchEnded());
    fireEvent.click(screen.getByRole('button', { name: 'Augmenter le score cible' }));
    expect(socket.lastSent('update-settings')).toMatchObject({
      payload: { expectedSettingsRevision: 0, settings: { target: 2, drawEnabled: true } },
    });
    // Envoi en cours : « Rejouer » attend la publication des réglages.
    key('Space', ' ');
    expect(socket.lastSent('rematch-ready')).toBeUndefined();
  });

  it('J2 déjà prêt, l’hôte change les réglages : J2 doit confirmer à nouveau', async () => {
    await joined(1);
    send(1, matchEnded({ ready: [false, true] }));
    send(1, matchEnded({ settings: { target: 2, drawEnabled: true }, settingsRevision: 1 }));
    expect(screen.getByText('Joueur 1 a modifié les réglages : confirmez à nouveau.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Réglages de la revanche' })).toHaveTextContent('Premier à 2 points');
  });
});

describe('PFC-016 — quitter', () => {
  it('Échap en pleine partie : room quittée, partie annulée sans trophée, retour à l’accueil', async () => {
    await joined(0);
    send(0, selecting());
    key('Escape', 'Escape');
    expect(socket.lastSent('leave')).toBeDefined();
    expect(screen.getByText('Partie annulée : aucun trophée attribué.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jouer en ligne' })).toBeInTheDocument();
  });

  it('« Retour à l’accueil » après la fin : départ silencieux', async () => {
    await joined(0);
    send(0, matchEnded());
    fireEvent.click(screen.getByRole('button', { name: 'Retour à l’accueil' }));
    expect(socket.lastSent('leave')).toBeDefined();
    expect(screen.queryByText('Partie annulée : aucun trophée attribué.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Jouer en ligne' })).toBeInTheDocument();
  });
});

describe('PFC-021-AC3 — 20 revanches en ligne', () => {
  it('ni écouteur, ni minuterie en plus d’une revanche à l’autre (même socket)', async () => {
    // Espions transparents : chaque appel est compté avec sa cible (`mock.contexts`), puis exécuté.
    const addSpy = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const removeSpy = vi.spyOn(EventTarget.prototype, 'removeEventListener');
    const onGlobal = (contexts: readonly unknown[]) => contexts.filter((target) => target === window || target === document).length;
    // Écouteurs du document et de la fenêtre (clavier, visibilité, réseau) : ceux qu'une fuite ferait croître.
    const globalListeners = () => onGlobal(addSpy.mock.contexts) - onGlobal(removeSpy.mock.contexts);
    try {
      await joined(0);
      const counts: { listeners: number; timers: number }[] = [];
      const answered = new Set<string>();
      for (let game = 1; game <= 20; game++) {
        const id = `m-${String(100 + game)}`;
        send(0, { phase: 'starting', settings: X1, match: startMatch(id, X1), roundId: 1, deadline: serverNow() + 2_200 });
        send(0, { phase: 'selecting', settings: X1, match: startMatch(id, X1), roundId: 1, deadline: serverNow() + CYCLE_MS.selection });
        key('KeyA', 'q');
        const play = playRound(startMatch(id, X1), ['fire', 'plant']);
        send(0, {
          phase: 'match-ended',
          settings: X1,
          match: play.match,
          roundId: 1,
          lastRound: { roundId: 1, choices: ['fire', 'plant'], resolution: play.round },
          trophies: [game, 0],
        });
        expect(screen.getByRole('heading', { name: 'Victoire' })).toBeInTheDocument();
        key('Space', ' ');
        // Durée réelle d'une partie : les minuteries échues partent, le lien reste vivant (pongs).
        for (let second = 0; second < 10; second++) {
          act(() => {
            vi.advanceTimersByTime(1000);
            for (const frame of socket.sent) {
              const id = String(frame['requestId']);
              if (frame['type'] !== 'ping' || answered.has(id)) continue;
              answered.add(id);
              socket.receive(encodeServerMessage(pongMessage(id, Math.round(serverNow()))));
            }
          });
        }
        counts.push({ listeners: globalListeners(), timers: vi.getTimerCount() });
      }
      expect(socket.sent.filter((frame) => frame['type'] === 'rematch-ready')).toHaveLength(20);
      expect(FakeSocket.instances).toHaveLength(1);
      expect(counts.at(-1)).toEqual(counts[1]);
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });
});
