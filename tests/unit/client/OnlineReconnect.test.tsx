import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stage from '../../../src/client/Stage.tsx';
import { RETRY_MIN_MS } from '../../../src/client/screens/online/ConnectionLost.tsx';
import { defaultPreferences, updatePreferences } from '../../../src/client/state/preferences.ts';
import { CYCLE_MS } from '../../../src/shared/cycle.ts';
import { startMatch, type PlayerIndex } from '../../../src/domain/index.ts';
import { RECONNECT_TIMEOUT_MS, encodeServerMessage, pongMessage, type RoomView } from '../../../src/shared/protocol/index.ts';
import { CODE, FakeSocket, TOKEN, ackFrame, entryResponse, errorFrame, stateFrame } from './onlineFakes.ts';

/**
 * PFC-017 — coupure, pause et reprise dans l'application complète (`Stage`, StrictMode), serveur joué
 * par une socket factice : place gardée par l'onglet, reprise après rechargement, reprise bornée du
 * lien, écran « Connexion interrompue » de la maquette et décompte de la pause publiée par le serveur.
 */

const SESSION_KEY = 'elem3nts.room.v1';
const OFFSET = 100_000;
/** Horloge du serveur factice : entière, comme `serverNow` (validé par le schéma). */
const serverNow = () => Math.round(performance.now()) + OFFSET;

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let revision = 10;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
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
  window.history.replaceState(null, '', '/');
});

const stored = () => sessionStorage.getItem(SESSION_KEY);

/** Avance l'horloge par pas de 1 s en répondant à chaque ping : le lien reste vivant (pas de coupure détectée). */
function advanceAlive(socket: FakeSocket, ms: number) {
  const answered = new Set<string>();
  for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
    act(() => {
      vi.advanceTimersByTime(Math.min(1000, ms - elapsed));
      for (const frame of socket.sent) {
        const id = String(frame['requestId']);
        if (frame['type'] !== 'ping' || answered.has(id)) continue;
        answered.add(id);
        socket.receive(encodeServerMessage(pongMessage(id, serverNow())));
      }
    });
  }
}
const dialog = () => screen.queryByRole('alertdialog');
const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

/** Trame d'état suivante (révision croissante) sur la socket donnée. */
function send(socket: FakeSocket, slot: PlayerIndex, overrides: Partial<RoomView>) {
  revision += 1;
  const frame = stateFrame(slot, { revision, ...overrides }, serverNow());
  act(() => {
    socket.receive(frame);
  });
}

/** Authentification réussie d'une socket : état puis ack, comme le serveur. */
function authenticate(socket: FakeSocket, slot: PlayerIndex, overrides: Partial<RoomView> = {}) {
  act(() => {
    socket.open();
  });
  send(socket, slot, overrides);
  act(() => {
    socket.receive(ackFrame(String(socket.sent[0]?.['requestId'])));
  });
}

function renderStage() {
  render(
    <StrictMode>
      <Stage />
    </StrictMode>,
  );
}

/** J1 crée la room ; socket authentifiée au lobby, horloge factice ensuite. */
async function hosting(): Promise<FakeSocket> {
  fetchMock.mockResolvedValueOnce(entryResponse(0));
  renderStage();
  fireEvent.click(screen.getByRole('button', { name: 'Jouer en ligne' }));
  fireEvent.click(screen.getByRole('button', { name: /^Créer une partie/ }));
  await screen.findByText('Code de la partie');
  const socket = FakeSocket.last();
  vi.useFakeTimers();
  authenticate(socket, 0, { connected: [true, true] });
  return socket;
}

const selecting = (overrides: Partial<RoomView> = {}): Partial<RoomView> => ({
  phase: 'selecting',
  match: startMatch('m-5', { target: 3, drawEnabled: true }),
  roundId: 1,
  deadline: serverNow() + CYCLE_MS.selection,
  ...overrides,
});

/** Sélection mise en pause par l'absence de J2 : échéance publiée = reconnexion dans `left` ms. */
const paused = (left = RECONNECT_TIMEOUT_MS, overrides: Partial<RoomView> = {}): Partial<RoomView> => ({
  ...selecting(),
  phase: 'paused',
  resumePhase: 'selecting',
  connected: [true, false],
  deadline: serverNow() + left,
  ...overrides,
});

describe('PFC-017 — place gardée par l’onglet et reprise après rechargement', () => {
  it('la place est gardée en sessionStorage pendant la room, jamais dans l’URL ; quitter l’oublie', async () => {
    const socket = await hosting();
    expect(JSON.parse(stored() ?? 'null')).toEqual({ roomCode: CODE, slot: 0, resumeToken: TOKEN });
    expect(window.location.href).not.toContain(TOKEN);
    expect(document.body.innerHTML).not.toContain(TOKEN);

    fireEvent.click(screen.getByRole('button', { name: 'Quitter' }));
    expect(socket.lastSent('leave')).toBeDefined();
    expect(stored()).toBeNull();
  });

  it('rechargement : la room est reprise aussitôt avec le même token (« Connexion… »), puis le lobby', () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode: CODE, slot: 1, resumeToken: TOKEN }));
    renderStage();
    expect(screen.getByRole('heading', { name: 'Connexion…' })).toBeInTheDocument();
    // StrictMode monte deux fois : la room n'est jamais quittée, une seule socket reste active.
    const sockets = FakeSocket.instances;
    expect(sockets.flatMap((socket) => socket.sent).filter((frame) => frame['type'] === 'leave')).toEqual([]);
    const socket = FakeSocket.last();
    authenticate(socket, 1, { connected: [true, true] });
    expect(socket.sent[0]).toMatchObject({ type: 'authenticate', payload: { resumeToken: TOKEN } });
    expect(screen.getByRole('heading', { name: 'Préparer le duel' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rechargement pendant la partie : l’arène reprend là où le serveur en est, son verrou sans son élément', () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode: CODE, slot: 0, resumeToken: TOKEN }));
    renderStage();
    vi.useFakeTimers();
    authenticate(FakeSocket.last(), 0, selecting({ selection: ['water', null] }));
    expect(document.querySelector('.arena')?.getAttribute('data-phase')).toBe('selecting');
    expect([...document.querySelectorAll('.arena__status')].map((node) => node.textContent)).toEqual(['Choix verrouillé', 'Réfléchit…']);
  });

  it('place refusée à la reprise (room fermée) : message, menu, place oubliée', () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode: CODE, slot: 0, resumeToken: TOKEN }));
    renderStage();
    const socket = FakeSocket.last();
    act(() => {
      socket.open();
      socket.receive(errorFrame('ROOM_UNAVAILABLE'));
      socket.serverClose(4404);
    });
    expect(screen.getByText('Cette partie n’existe pas ou n’est plus disponible.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Choisissez' })).toBeInTheDocument();
    expect(stored()).toBeNull();
  });

  it('valeur gardée altérée : ignorée et effacée, accueil normal', () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode: CODE, slot: 0, resumeToken: 'court' }));
    renderStage();
    expect(screen.getByRole('button', { name: 'Jouer en ligne' })).toBeInTheDocument();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(stored()).toBeNull();
  });

  it('une invitation ouverte l’emporte sur la place gardée, qui est oubliée', () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode: CODE, slot: 0, resumeToken: TOKEN }));
    window.history.replaceState(null, '', '/p/K7F2QX9A');
    renderStage();
    expect(screen.getByRole('heading', { name: 'Rejoindre' })).toBeInTheDocument();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(stored()).toBeNull();
  });
});

describe('PFC-017 — coupure de son lien : « Connexion interrompue », reprise bornée', () => {
  it('coupure : dialogue « Reconnexion… » de la maquette, focus sur « Réessayer », reprise puis « Connexion rétablie. »', async () => {
    const socket = await hosting();
    act(() => {
      socket.serverClose(1006);
    });
    const lost = screen.getByRole('alertdialog');
    expect(within(lost).getByText('Connexion interrompue')).toBeInTheDocument();
    expect(within(lost).getByRole('heading', { name: 'Reconnexion…' })).toBeInTheDocument();
    expect(lost).toHaveAccessibleDescription('Tentative de reconnexion au serveur de partie.');
    expect(screen.getByRole('button', { name: 'Réessayer' })).toHaveFocus();
    expect(stored()).not.toBeNull();

    advance(0);
    authenticate(FakeSocket.last(), 0, { connected: [true, true] });
    expect(screen.getByText('Connexion rétablie.')).toBeInTheDocument();
    // « Reconnexion… » reste affiché au moins sa durée minimale, puis sort en fondu.
    advance(RETRY_MIN_MS - 100);
    expect(dialog()).not.toBeNull();
    advance(100);
    expect(document.querySelector('.lost--leaving')).not.toBeNull();
    advance(300);
    expect(dialog()).toBeNull();
    expect(screen.getByRole('heading', { name: 'Préparer le duel' })).toBeInTheDocument();
  });

  it('sans reprise dans les 30 s : message explicite, menu, place oubliée', async () => {
    const socket = await hosting();
    act(() => {
      socket.serverClose(1006);
    });
    for (let elapsed = 0; elapsed <= RECONNECT_TIMEOUT_MS; elapsed += 500) {
      advance(500);
      const last = FakeSocket.last();
      if (last.readyState === 0) {
        act(() => {
          last.serverClose(1006);
        });
      }
    }
    expect(screen.getByText('Connexion perdue : la partie n’a pas pu reprendre dans les 30 secondes.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Choisissez' })).toBeInTheDocument();
    expect(stored()).toBeNull();
  });

  it('« Quitter la partie » pendant la coupure : accueil, place oubliée, plus aucune tentative', async () => {
    const socket = await hosting();
    send(socket, 0, selecting());
    act(() => {
      socket.serverClose(1006);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Quitter la partie' }));
    expect(screen.getByText('Partie annulée : aucun trophée attribué.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jouer en ligne' })).toBeInTheDocument();
    expect(stored()).toBeNull();
    const count = FakeSocket.instances.length;
    advance(RECONNECT_TIMEOUT_MS);
    expect(FakeSocket.instances).toHaveLength(count);
  });

  it('après la reprise, une confirmation perdue avec l’ancienne socket peut être renvoyée', async () => {
    const socket = await hosting();
    fireEvent.click(screen.getByRole('button', { name: /^Prêt/ }));
    expect(socket.lastSent('ready')).toBeDefined();
    act(() => {
      socket.serverClose(1006);
    });
    advance(0);
    const fresh = FakeSocket.last();
    authenticate(fresh, 0, { connected: [true, true] });
    fireEvent.click(screen.getByRole('button', { name: /^Prêt/ }));
    expect(fresh.lastSent('ready')).toBeDefined();
  });

  it('son choix envoyé : gardé si le serveur publie son verrou après la reprise, retiré sinon', async () => {
    const socket = await hosting();
    send(socket, 0, selecting());
    fireEvent.keyDown(document.body, { code: 'KeyA', key: 'q' });
    const statuses = () => [...document.querySelectorAll('.arena__status')].map((node) => node.textContent);
    expect(statuses()[0]).toBe('Choix verrouillé · Feu');

    act(() => {
      socket.serverClose(1006);
    });
    advance(0);
    authenticate(FakeSocket.last(), 0, selecting({ selection: ['fire', null] }));
    expect(statuses()[0]).toBe('Choix verrouillé · Feu');

    act(() => {
      FakeSocket.last().serverClose(1006);
    });
    advance(0);
    // Choix perdu avec la socket (jamais reçu) : retiré, un nouveau choix reste possible.
    authenticate(FakeSocket.last(), 0, selecting({ roundId: 1 }));
    expect(statuses()[0]).toBe('Choix en cours…');
  });
});

describe('PFC-017 — adversaire absent : partie en pause, décompte publié par le serveur', () => {
  it('pause : « Joueur 2 ne répond plus », décompte de l’échéance de reconnexion ; reprise : dialogue fermé', async () => {
    const socket = await hosting();
    send(socket, 0, selecting());
    send(socket, 0, paused());
    const lost = screen.getByRole('alertdialog');
    expect(within(lost).getByRole('heading', { name: 'Joueur 2 ne répond plus' })).toBeInTheDocument();
    const count = () => document.querySelector('.lost__count')?.textContent;
    expect(document.querySelector('.lost__sub')).toHaveTextContent(/^La manche est en pause\.\s*Les scores sont conservés encore 30 s/);
    expect(count()).toBe('30 s');
    // Lecteurs d'écran : le nombre en toutes lettres, sans annonce à chaque seconde.
    expect(lost).toHaveAccessibleDescription('La manche est en pause. Les scores sont conservés encore 30 secondes.');
    expect(document.querySelector('.lost__count')).toHaveAttribute('aria-hidden', 'true');
    advanceAlive(socket, 7_000);
    expect(count()).toBe('23 s');
    advanceAlive(socket, 30_000);
    expect(count()).toBe('0 s');

    send(socket, 0, selecting({ deadline: serverNow() + 2000 }));
    advance(0);
    advance(300);
    expect(dialog()).toBeNull();
    expect(document.querySelector('.arena')?.getAttribute('data-phase')).toBe('selecting');
  });

  it('les touches d’élément ne jouent pas pendant la pause ; un choix refusé car la manche est en pause le dit', async () => {
    const socket = await hosting();
    send(socket, 0, selecting());
    fireEvent.keyDown(document.body, { code: 'KeyA', key: 'q' });
    const requestId = String(socket.lastSent('submit-choice')?.['requestId']);
    send(socket, 0, paused());
    act(() => {
      socket.receive(errorFrame('INVALID_PHASE', requestId));
    });
    expect(screen.getByText('Choix non pris en compte : la manche est en pause.')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { code: 'KeyS', key: 's' });
    expect(socket.sent.filter((frame) => frame['type'] === 'submit-choice')).toHaveLength(1);
  });

  it('« Réessayer » : resynchronisation (« Reconnexion… »), puis retour à la pause si l’adversaire manque toujours', async () => {
    const socket = await hosting();
    send(socket, 0, paused());
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(screen.getByRole('heading', { name: 'Reconnexion…' })).toBeInTheDocument();
    const fresh = FakeSocket.last();
    expect(fresh).not.toBe(socket);
    authenticate(fresh, 0, paused(20_000));
    advance(RETRY_MIN_MS);
    expect(screen.getByRole('heading', { name: 'Joueur 2 ne répond plus' })).toBeInTheDocument();
    expect(socket.closedByClient).toBe(true);
  });

  it('« Quitter la partie » pendant la pause : départ envoyé, partie annulée sans trophée', async () => {
    const socket = await hosting();
    send(socket, 0, paused());
    fireEvent.click(screen.getByRole('button', { name: 'Quitter la partie' }));
    expect(socket.lastSent('leave')).toBeDefined();
    expect(screen.getByText('Partie annulée : aucun trophée attribué.')).toBeInTheDocument();
  });

  it('délai échu côté serveur : « Partie fermée : Joueur 2 n’est pas revenu dans les 30 secondes. »', async () => {
    const socket = await hosting();
    send(socket, 0, paused());
    act(() => {
      socket.receive('{"v":1,"type":"room-closed","reason":"reconnect-timeout"}');
      socket.serverClose(4404);
    });
    expect(screen.getByText('Partie fermée : Joueur 2 n’est pas revenu dans les 30 secondes.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Choisissez' })).toBeInTheDocument();
    expect(stored()).toBeNull();
  });
});

describe('PFC-021 — « Connexion interrompue » au clavier', () => {
  it('Tab reste dans le dialogue, Échap ne quitte pas la room ; à la reprise le focus revient dans l’arène', async () => {
    const socket = await hosting();
    send(socket, 0, selecting());
    send(socket, 0, paused());
    const lost = screen.getByRole('alertdialog');
    const retry = within(lost).getByRole('button', { name: 'Réessayer' });
    const quit = within(lost).getByRole('button', { name: 'Quitter la partie' });
    expect(retry).toHaveFocus();

    quit.focus();
    fireEvent.keyDown(quit, { key: 'Tab', code: 'Tab' });
    expect(retry).toHaveFocus();
    fireEvent.keyDown(retry, { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(quit).toHaveFocus();

    fireEvent.keyDown(quit, { key: 'Escape', code: 'Escape' });
    fireEvent.keyDown(quit, { key: ' ', code: 'Space' });
    expect(socket.lastSent('leave')).toBeUndefined();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    send(socket, 0, selecting({ deadline: serverNow() + 2000 }));
    advance(0);
    advance(300);
    expect(dialog()).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: /^Arène/ }));
  });
});
