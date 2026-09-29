import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stage from '../../../src/client/Stage.tsx';
import { defaultPreferences, updatePreferences } from '../../../src/client/state/preferences.ts';
import { startMatch, DEFAULT_SETTINGS } from '../../../src/domain/index.ts';
import { CODE, FakeSocket, TOKEN, ackFrame, closedFrame, entryResponse, errorFrame, errorResponse, stateFrame } from './onlineFakes.ts';

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const space = () => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: ' ', code: 'Space' });
};

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  localStorage.clear();
  updatePreferences(defaultPreferences());
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1280);
  FakeSocket.reset();
  vi.stubGlobal('WebSocket', FakeSocket);
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
});

/** Presse-papier de l'environnement (absent de jsdom) : remplacé pour un test, retiré ensuite. */
function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

function renderOnline() {
  render(
    <StrictMode>
      <Stage />
    </StrictMode>,
  );
  fireEvent.click(button('Jouer en ligne'));
  expect(screen.getByRole('heading', { name: 'Choisissez' })).toHaveFocus();
}

/** Réponse HTTP différée : le test décide quand elle arrive. */
function deferredResponse() {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Hôte connecté : room créée, socket ouverte et authentifiée, premier état reçu. */
async function asHost(frame = stateFrame(0, { connected: [true, false] })) {
  fetchMock.mockResolvedValueOnce(entryResponse(0));
  renderOnline();
  fireEvent.click(button(/^Créer une partie/));
  await screen.findByText('Code de la partie');
  const socket = FakeSocket.last();
  act(() => {
    socket.open();
    socket.receive(frame);
  });
  return socket;
}

async function asGuest(frame = stateFrame(1)) {
  fetchMock.mockResolvedValueOnce(entryResponse(1));
  renderOnline();
  fireEvent.click(button(/^Rejoindre une partie/));
  fireEvent.change(screen.getByLabelText('Code reçu'), { target: { value: 'k7m2q9xa' } });
  fireEvent.click(button('Rejoindre'));
  await screen.findByRole('heading', { name: 'Connexion…' });
  const socket = FakeSocket.last();
  act(() => {
    socket.open();
    socket.receive(frame);
  });
  return socket;
}

describe('PFC-015 — créer une partie', () => {
  it('état de chargement puis code à partager ; un double clic ne crée qu’une room (AC3)', async () => {
    const pending = deferredResponse();
    fetchMock.mockReturnValueOnce(pending.promise);
    renderOnline();

    const create = button(/^Créer une partie/);
    fireEvent.click(create);
    fireEvent.click(create);
    expect(create).toHaveAttribute('aria-busy', 'true');
    expect(within(create).getByText(/Création de la partie/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(entryResponse(0));
      await pending.promise;
    });
    expect(await screen.findByText('K7M2·Q9XA')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Votre partie' })).toHaveFocus();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(screen.getByText(/Connexion à la partie/)).toBeInTheDocument();

    const socket = FakeSocket.last();
    act(() => {
      socket.open();
      socket.receive(stateFrame(0, { connected: [true, false] }));
    });
    expect(socket.sent[0]).toMatchObject({ type: 'authenticate', payload: { resumeToken: TOKEN } });
    expect(screen.getByText(/En attente d’un adversaire/)).toBeInTheDocument();
    // Le token n'apparaît nulle part dans le DOM.
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it.each([
    [() => Promise.reject(new TypeError('Failed to fetch')), 'Connexion impossible : vérifiez votre réseau puis réessayez.'],
    [() => Promise.resolve(errorResponse(503, 'CODE_COLLISION')), 'Impossible de créer une partie pour le moment : réessayez.'],
    [() => Promise.resolve(errorResponse(500, 'INTERNAL')), 'Le serveur n’a pas pu répondre : réessayez dans un instant.'],
    [() => Promise.resolve(errorResponse(429, 'RATE_LIMITED')), 'Trop de tentatives : patientez une minute puis réessayez.'],
  ])('PFC-015-AC3, PFC-020-AC1 — échec de création explicite, puis nouvel essai possible', async (reply, message) => {
    fetchMock.mockImplementationOnce(reply);
    renderOnline();
    fireEvent.click(button(/^Créer une partie/));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(button(/^Créer une partie/)).toHaveAttribute('aria-disabled', 'false');
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('PFC-015-AC1 — copie le lien d’invitation, qui ne contient que le code', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });
    await asHost();

    fireEvent.click(button('Copier le lien d’invitation'));

    expect(await screen.findByRole('button', { name: 'Lien copié' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/p/${CODE}`);
    expect(JSON.stringify(writeText.mock.calls)).not.toContain(TOKEN);
  });

  it('PFC-015-AC3 — presse-papier refusé : message explicite et lien sélectionné pour une copie manuelle', async () => {
    setClipboard({ writeText: () => Promise.reject(new Error('refus')) });
    await asHost();

    fireEvent.click(button('Copier le lien d’invitation'));

    expect(await screen.findByText('Copie automatique impossible : copiez le lien ci-dessous.')).toHaveAttribute('role', 'alert');
    const field = screen.getByRole('textbox', { name: 'Lien d’invitation' });
    expect(field).toHaveValue(`${window.location.origin}/p/${CODE}`);
    expect(field).toHaveAttribute('readonly');
  });

  it('PFC-015-AC3 — presse-papier absent (contexte non sécurisé) : même repli', async () => {
    setClipboard(undefined);
    await asHost();
    fireEvent.click(button('Copier le lien d’invitation'));
    expect(await screen.findByRole('textbox', { name: 'Lien d’invitation' })).toBeInTheDocument();
  });

  it('applique la préférence « Match nul » de l’hôte à sa room', async () => {
    updatePreferences({ drawEnabled: false });
    const socket = await asHost();
    expect(socket.lastSent('update-settings')).toMatchObject({
      payload: { expectedSettingsRevision: 0, settings: { target: 3, drawEnabled: false } },
    });
  });

  it('Annuler quitte la room (leave) et revient au menu', async () => {
    const socket = await asHost();
    fireEvent.click(button('Annuler'));
    expect(socket.lastSent('leave')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Choisissez' })).toBeInTheDocument();
  });
});

describe('PFC-015 — rejoindre une partie', () => {
  it.each([
    ['', 'Saisissez le code reçu.'],
    ['K7M2', 'Code incomplet — 8 caractères attendus.'],
    ['K7M2Q9X0', 'Caractère invalide : un code ne contient ni I, ni O, ni 0, ni 1.'],
  ])('saisie « %s » refusée sans requête', (value, message) => {
    renderOnline();
    fireEvent.click(button(/^Rejoindre une partie/));
    fireEvent.change(screen.getByLabelText('Code reçu'), { target: { value } });
    fireEvent.click(button('Rejoindre'));
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByLabelText('Code reçu')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [404, 'ROOM_UNAVAILABLE', 'Cette partie n’existe pas ou n’est plus disponible.'],
    [409, 'ROOM_FULL', 'Cette partie est déjà complète.'],
    [429, 'RATE_LIMITED', 'Trop de tentatives : patientez une minute puis réessayez.'],
  ])('PFC-015-AC3, PFC-020-AC1 — %i : erreur explicite, code conservé pour corriger', async (status, code, message) => {
    fetchMock.mockResolvedValueOnce(errorResponse(status, code));
    renderOnline();
    fireEvent.click(button(/^Rejoindre une partie/));
    fireEvent.change(screen.getByLabelText('Code reçu'), { target: { value: 'K7M2·Q9XA' } });
    fireEvent.click(button('Rejoindre'));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByLabelText('Code reçu')).toHaveValue('K7M2·Q9XA');
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('PFC-015-AC3 — réseau coupé pendant la connexion : message explicite', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderOnline();
    fireEvent.click(button(/^Rejoindre une partie/));
    fireEvent.change(screen.getByLabelText('Code reçu'), { target: { value: CODE } });
    fireEvent.click(button('Rejoindre'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connexion impossible : vérifiez votre réseau puis réessayez.');
  });

  it('un lien d’invitation ouvre la saisie préremplie puis quitte l’adresse d’invitation', () => {
    window.history.replaceState(null, '', `/p/${CODE.toLowerCase()}`);
    render(<Stage />);
    expect(screen.getByLabelText('Code reçu')).toHaveValue('K7M2·Q9XA');
    expect(window.location.pathname).toBe('/');
  });

  it('un lien d’invitation invalide ramène à l’accueil avec un message', () => {
    window.history.replaceState(null, '', '/p/NOPE');
    render(<Stage />);
    expect(screen.getByText('Lien d’invitation invalide : demandez un nouveau lien à votre adversaire.')).toBeInTheDocument();
    expect(button('Jouer en ligne')).toBeInTheDocument();
  });
});

describe('PFC-015 — lobby synchronisé', () => {
  it('PFC-015-AC2 — l’invité voit les réglages de l’hôte sans pouvoir les changer', async () => {
    await asGuest(stateFrame(1, { settings: { target: 7, drawEnabled: false } }));

    expect(screen.getByRole('heading', { name: 'Préparer le duel' })).toHaveFocus();
    expect(screen.getByText('Premier à 7 points')).toBeInTheDocument();
    expect(screen.getByText('Désactivé')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Augmenter le score cible' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Match nul' })).not.toBeInTheDocument();
  });

  it('PFC-015-S2 — une modification de l’hôte retire la confirmation de l’invité, qui voit les nouveaux réglages', async () => {
    const socket = await asGuest();
    space();
    const ready = socket.lastSent('ready');
    expect(ready).toMatchObject({ payload: { expectedSettingsRevision: 0 } });
    act(() => {
      socket.receive(stateFrame(1, { revision: 4, ready: [false, true] }));
      socket.receive(ackFrame(String(ready?.['requestId']), 4));
    });
    expect(screen.getByRole('button', { name: /Prêt — en attente de Joueur 1/ })).toHaveAttribute('aria-disabled', 'true');

    act(() => {
      socket.receive(stateFrame(1, { revision: 5, settingsRevision: 1, settings: { target: 5, drawEnabled: true } }));
    });

    expect(screen.getByText('Premier à 5 points')).toBeInTheDocument();
    expect(screen.getAllByText('Pas encore prêt')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^Prêt/ })).toHaveAttribute('aria-disabled', 'false');
    expect(screen.getByText('Joueur 1 a modifié les réglages : confirmez à nouveau.')).toBeInTheDocument();
  });

  it('réglages de l’hôte envoyés un par un, la dernière valeur l’emporte (pas de STALE_SETTINGS)', async () => {
    const socket = await asHost(stateFrame(0));
    const plus = button('Augmenter le score cible');

    fireEvent.click(plus);
    fireEvent.click(plus);
    const updates = socket.sent.filter((frame) => frame['type'] === 'update-settings');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ payload: { expectedSettingsRevision: 0, settings: { target: 4 } } });
    // Valeur voulue affichée aussitôt sur le contrôle de l'hôte ; confirmation suspendue.
    expect(screen.getByText('Premier à 5 points')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Envoi des réglages…' })).toHaveAttribute('aria-disabled', 'true');

    act(() => {
      socket.receive(stateFrame(0, { revision: 4, settingsRevision: 1, settings: { target: 4, drawEnabled: true } }));
      socket.receive(ackFrame(String(updates[0]?.['requestId']), 4));
    });
    expect(socket.lastSent('update-settings')).toMatchObject({ payload: { expectedSettingsRevision: 1, settings: { target: 5 } } });

    const last = socket.lastSent('update-settings');
    act(() => {
      socket.receive(stateFrame(0, { revision: 5, settingsRevision: 2, settings: { target: 5, drawEnabled: true } }));
      socket.receive(ackFrame(String(last?.['requestId']), 5));
    });
    expect(socket.sent.filter((frame) => frame['type'] === 'update-settings')).toHaveLength(2);
    expect(button(/^Prêt/)).toHaveAttribute('aria-disabled', 'false');
  });

  it('un refus de réglages revient à la vérité du serveur, message explicite', async () => {
    const socket = await asHost(stateFrame(0));
    fireEvent.click(button('Augmenter le score cible'));
    const update = socket.lastSent('update-settings');
    act(() => {
      socket.receive(errorFrame('INVALID_PHASE', String(update?.['requestId'])));
    });
    expect(screen.getByText('Premier à 3 points')).toBeInTheDocument();
    expect(screen.getByText('Action impossible à ce moment de la partie.')).toBeInTheDocument();
  });

  it('Espace confirme seulement au lobby, deux places connectées, une seule fois', async () => {
    const socket = await asGuest(stateFrame(1, { connected: [false, true] }));
    expect(button('En attente de Joueur 1')).toHaveAttribute('aria-disabled', 'true');
    space();
    expect(socket.lastSent('ready')).toBeUndefined();

    act(() => {
      socket.receive(stateFrame(1, { revision: 4 }));
    });
    space();
    space();
    expect(socket.sent.filter((frame) => frame['type'] === 'ready')).toHaveLength(1);
    expect(button('Confirmation…')).toHaveAttribute('aria-busy', 'true');
  });

  it('PFC-015-S1 — deux confirmations : la partie commence (ouverture de l’arène, PFC-016)', async () => {
    const socket = await asGuest();
    const match = startMatch('m-9', DEFAULT_SETTINGS);
    act(() => {
      socket.receive(stateFrame(1, { revision: 9, phase: 'starting', match, roundId: 1, deadline: 3_200 }));
    });
    expect(screen.getByRole('heading', { name: 'Arène · manche 1 · premier à 3' })).toHaveFocus();
    expect(screen.getByText('Que le duel commence')).toBeInTheDocument();
    // Soi à gauche (« Vous »), l'adversaire à droite, comme la maquette en ligne.
    expect([...document.querySelectorAll('.arena__name')].map((node) => node.textContent)).toEqual(['Vous', 'Joueur 1']);
    expect(document.querySelector('[data-match-id="m-9"]')).not.toBeNull();
  });

  it('départ de l’adversaire : message explicite, retour au menu', async () => {
    const socket = await asGuest();
    act(() => {
      socket.receive(closedFrame('left'));
      socket.serverClose(4404);
    });
    expect(screen.getByText('Joueur 1 a quitté la partie.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Choisissez' })).toBeInTheDocument();
  });

  it.each([
    [4409, 'Partie reprise dans un autre onglet : cette page est déconnectée.'],
    [4401, 'Connexion non reconnue : rejoignez la partie à nouveau.'],
  ])('fermeture %i : message explicite, aucune reconnexion automatique', async (code, message) => {
    const socket = await asHost(stateFrame(0));
    act(() => {
      socket.serverClose(code);
    });
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('Échap au lobby quitte la room', async () => {
    const socket = await asGuest();
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(socket.lastSent('leave')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Choisissez' })).toBeInTheDocument();
  });
});
