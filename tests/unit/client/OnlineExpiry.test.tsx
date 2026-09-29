import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stage from '../../../src/client/Stage.tsx';
import { endMessage, isLastingEnd } from '../../../src/client/online/messages.ts';
import { defaultPreferences, updatePreferences } from '../../../src/client/state/preferences.ts';
import { CYCLE_MS } from '../../../src/shared/cycle.ts';
import { startMatch, type PlayerIndex } from '../../../src/domain/index.ts';
import type { RoomView } from '../../../src/shared/protocol/index.ts';
import { FakeSocket, ackFrame, entryResponse, stateFrame } from './onlineFakes.ts';

/**
 * PFC-018 — fermeture d'une room par le serveur pour inactivité (30 min) ou durée maximale (4 h), dans
 * l'application complète (`Stage`, StrictMode), serveur joué par une socket factice : raison lisible,
 * retour au menu en ligne, place oubliée, et message maintenu jusqu'à sa fermeture (le joueur était
 * probablement absent quand la room a expiré).
 */

const SESSION_KEY = 'elem3nts.room.v1';
const OFFSET = 100_000;
const serverNow = () => Math.round(performance.now()) + OFFSET;
/** Durée d'affichage d'une notification brève (Toast). */
const TOAST_MS = 4000;

const INACTIVE = 'Partie fermée après 30 minutes sans activité : aucun trophée attribué.';
const MAX_DURATION = 'Partie fermée : durée maximale de 4 heures atteinte, aucun trophée attribué.';

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

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

function send(socket: FakeSocket, slot: PlayerIndex, overrides: Partial<RoomView>) {
  revision += 1;
  const frame = stateFrame(slot, { revision, ...overrides }, serverNow());
  act(() => {
    socket.receive(frame);
  });
}

/** J1 crée la room ; socket authentifiée au lobby, horloge factice ensuite. */
async function hosting(): Promise<FakeSocket> {
  fetchMock.mockResolvedValueOnce(entryResponse(0));
  render(
    <StrictMode>
      <Stage />
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Jouer en ligne' }));
  fireEvent.click(screen.getByRole('button', { name: /^Créer une partie/ }));
  await screen.findByText('Code de la partie');
  const socket = FakeSocket.last();
  vi.useFakeTimers();
  act(() => {
    socket.open();
  });
  send(socket, 0, { connected: [true, true] });
  act(() => {
    socket.receive(ackFrame(String(socket.sent[0]?.['requestId'])));
  });
  return socket;
}

/** Le serveur ferme la room : `room-closed {reason}` puis 4404, comme `#terminate`. */
function closeRoom(socket: FakeSocket, reason: string) {
  act(() => {
    socket.receive(JSON.stringify({ v: 1, type: 'room-closed', reason }));
    socket.serverClose(4404);
  });
}

const toasts = () => within(screen.getByRole('status'));

describe('PFC-018-AC1 — fermeture par le serveur : raison lisible, gardée jusqu’à ce que le joueur la ferme', () => {
  it('PFC-018-S1 — inactivité en pleine partie : menu en ligne, place oubliée, message persistant puis fermé à la demande', async () => {
    const socket = await hosting();
    send(socket, 0, {
      phase: 'selecting',
      match: startMatch('m-5', { target: 3, drawEnabled: true }),
      roundId: 7,
      deadline: serverNow() + CYCLE_MS.selection,
    });

    closeRoom(socket, 'inactive');

    expect(screen.getByRole('heading', { name: 'Choisissez' })).toBeInTheDocument();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(toasts().getByText(INACTIVE)).toBeInTheDocument();
    // Toujours affiché bien après la durée d'une notification brève : le joueur revient de son absence.
    advance(10 * TOAST_MS);
    expect(toasts().getByText(INACTIVE)).toBeInTheDocument();
    // Aucune tentative de reprise : la room est fermée par le serveur.
    expect(FakeSocket.instances).toHaveLength(1);

    fireEvent.click(toasts().getByRole('button', { name: 'Fermer la notification' }));
    advance(300);
    expect(toasts().queryByText(INACTIVE)).toBeNull();
  });

  it('durée maximale au lobby : même retour au menu, message persistant', async () => {
    const socket = await hosting();
    closeRoom(socket, 'max-duration');

    expect(screen.getByRole('heading', { name: 'Choisissez' })).toBeInTheDocument();
    advance(10 * TOAST_MS);
    expect(toasts().getByText(MAX_DURATION)).toBeInTheDocument();
  });

  it('une fin vécue en direct (départ de l’adversaire) reste une notification brève', async () => {
    const socket = await hosting();
    closeRoom(socket, 'left');
    expect(toasts().getByText('Joueur 2 a quitté la partie.')).toBeInTheDocument();
    advance(TOAST_MS + 300);
    expect(toasts().queryByText('Joueur 2 a quitté la partie.')).toBeNull();
  });
});

describe('PFC-018 — textes de fin', () => {
  it('chaque motif d’expiration dit ce qui s’est passé et qu’aucun trophée n’est attribué ; seuls les fins survenues en absence persistent', () => {
    expect(endMessage('inactive', 'Joueur 2')).toBe(INACTIVE);
    expect(endMessage('max-duration', 'Joueur 2')).toBe(MAX_DURATION);
    expect(endMessage('reconnect-timeout', 'Joueur 1')).toBe('Partie fermée : Joueur 1 n’est pas revenu dans les 30 secondes.');
    expect(['inactive', 'max-duration', 'closed-while-away'].every((reason) => isLastingEnd(reason as never))).toBe(true);
    expect(['left', 'reconnect-timeout', 'replaced', 'lost', 'limit'].some((reason) => isLastingEnd(reason as never))).toBe(false);
  });
});
