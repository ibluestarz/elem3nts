import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ATTEMPT_TIMEOUT_MS,
  LEAVE_GRACE_MS,
  PING_INTERVAL_MS,
  RoomConnection,
  roomSocketUrl,
  type ConnectionEvent,
} from '../../../src/client/online/connection.ts';
import { encodeServerMessage, pongMessage } from '../../../src/shared/protocol/index.ts';
import { CODE, FakeSocket, TOKEN, ackFrame, closedFrame, errorFrame, stateFrame } from './onlineFakes.ts';

const entry = { roomCode: CODE, slot: 0 as const, resumeToken: TOKEN };

/** Connexions créées par le test, fermées après lui : aucune minuterie ne survit d'un test à l'autre. */
const created: RoomConnection[] = [];

function connect() {
  const events: ConnectionEvent[] = [];
  const connection = new RoomConnection(entry, (event) => events.push(event), (url) => new FakeSocket(url) as unknown as WebSocket);
  created.push(connection);
  return { connection, events, socket: FakeSocket.last() };
}

beforeEach(() => {
  FakeSocket.reset();
});

afterEach(() => {
  for (const connection of created.splice(0)) connection.dispose();
  vi.useRealTimers();
});

describe('PFC-015 — connexion à la room (D37)', () => {
  it('ouvre la socket de même origine, sans token dans l’URL', () => {
    expect(roomSocketUrl(CODE, { protocol: 'https:', host: 'elem3nts.example' })).toBe(`wss://elem3nts.example/api/rooms/${CODE}/ws`);
    expect(roomSocketUrl(CODE, { protocol: 'http:', host: 'localhost:4173' })).toBe(`ws://localhost:4173/api/rooms/${CODE}/ws`);
    const { socket } = connect();
    expect(socket.url).not.toContain(TOKEN);
  });

  it('première trame : authenticate avec le token, rien avant l’ouverture', () => {
    const { connection, socket } = connect();
    expect(connection.send({ type: 'ready', payload: { expectedSettingsRevision: 0 } })).toBeNull();
    expect(socket.sent).toEqual([]);

    socket.open();

    expect(socket.sent).toHaveLength(1);
    expect(socket.sent[0]).toMatchObject({ v: 1, type: 'authenticate', payload: { resumeToken: TOKEN } });
    expect(socket.sent[0]?.['requestId']).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('commandes enveloppées avec un requestId unique', () => {
    const { connection, socket } = connect();
    socket.open();
    const first = connection.send({ type: 'ready', payload: { expectedSettingsRevision: 2 } });
    const second = connection.send({ type: 'ping', payload: {} });
    expect(first).not.toBe(second);
    expect(socket.lastSent('ready')).toEqual({ v: 1, requestId: first, type: 'ready', payload: { expectedSettingsRevision: 2 } });
  });

  it('publie les états valides et ignore les révisions plus anciennes et les trames invalides', () => {
    const { events, socket } = connect();
    socket.open();

    socket.receive(stateFrame(0, { revision: 5 }));
    socket.receive(stateFrame(0, { revision: 4, ready: [true, false] }));
    socket.receive('{"v":1,"type":"state"}');
    socket.receive('pas du json');
    socket.receive(stateFrame(0, { revision: 5, ready: [false, true] }));

    const states = events.flatMap((event) => (event.type === 'state' ? [event.state] : []));
    expect(states.map((state) => state.revision)).toEqual([5, 5]);
    expect(states[1]?.ready).toEqual([false, true]);
  });

  it('relaie ack et refus avec leur requestId', () => {
    const { connection, events, socket } = connect();
    socket.open();
    const id = connection.send({ type: 'ready', payload: { expectedSettingsRevision: 0 } }) ?? '';
    socket.receive(ackFrame(id));
    socket.receive(errorFrame('STALE_SETTINGS', id));
    expect(events).toContainEqual({ type: 'ack', requestId: id });
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', requestId: id, code: 'STALE_SETTINGS' }));
  });

  it.each([
    [4401, 'unauthorized'],
    [4404, 'room-unavailable'],
    [4409, 'replaced'],
    [4429, 'limit'],
  ])('fermeture %i → fin « %s », une seule fois, sans reconnexion', (code, reason) => {
    const { events, socket } = connect();
    socket.open();
    socket.serverClose(code);
    socket.serverClose(code);
    expect(events.filter((event) => event.type === 'ended')).toEqual([{ type: 'ended', reason }]);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('room-closed puis 4404 : la fin porte le motif de fermeture', () => {
    const { events, socket } = connect();
    socket.open();
    socket.receive(closedFrame('left'));
    socket.serverClose(4404);
    expect(events).toEqual([{ type: 'ended', reason: 'left' }]);
  });

  it('4408 : une seule réouverture authentifiée aussitôt, puis abandon', () => {
    const { events, socket } = connect();
    socket.open();
    socket.serverClose(4408);

    expect(FakeSocket.instances).toHaveLength(2);
    const retry = FakeSocket.last();
    retry.open();
    expect(retry.sent[0]).toMatchObject({ type: 'authenticate', payload: { resumeToken: TOKEN } });
    retry.serverClose(4408);

    expect(FakeSocket.instances).toHaveLength(2);
    expect(events).toEqual([{ type: 'ended', reason: 'auth-timeout' }]);
  });

  it('leave : envoie le départ puis se tait ; socket fermée après le délai de grâce', () => {
    vi.useFakeTimers();
    const { connection, events, socket } = connect();
    socket.open();

    connection.leave();
    expect(socket.lastSent('leave')).toMatchObject({ type: 'leave', payload: {} });
    socket.receive(closedFrame('left'));
    socket.serverClose(4404);
    expect(events).toEqual([]);
    expect(connection.send({ type: 'ping', payload: {} })).toBeNull();

    const other = connect();
    other.socket.open();
    other.connection.leave();
    expect(other.socket.closedByClient).toBe(false);
    vi.advanceTimersByTime(LEAVE_GRACE_MS);
    expect(other.socket.closedByClient).toBe(true);
  });

  it('aucune écriture console, donc aucun token journalisé', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method));
    const { connection, socket } = connect();
    socket.open();
    socket.receive(stateFrame(0));
    socket.receive('invalide');
    socket.serverClose(4401);
    connection.dispose();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('PFC-017 — reprise bornée après une coupure', () => {
  /** Connexion authentifiée (état puis ack), horloge factice. */
  function online() {
    vi.useFakeTimers();
    const opened = connect();
    opened.socket.open();
    opened.socket.receive(stateFrame(0, { revision: 5 }));
    opened.socket.receive(ackFrame(String(opened.socket.sent[0]?.['requestId'])));
    return opened;
  }

  const links = (events: readonly ConnectionEvent[]) => events.flatMap((event) => (event.type === 'link' ? [event.status] : []));

  it.each([1006, 1001, 1011, 1012])('fermeture %i : reprise aussitôt avec le même token, sans fin', (code) => {
    const { events, socket } = online();
    socket.serverClose(code);

    expect(links(events)).toEqual(['reconnecting']);
    expect(events.some((event) => event.type === 'ended')).toBe(false);
    vi.advanceTimersByTime(0);
    const retry = FakeSocket.last();
    expect(retry).not.toBe(socket);
    retry.open();
    expect(retry.sent[0]).toMatchObject({ type: 'authenticate', payload: { resumeToken: TOKEN } });
    expect(retry.url).not.toContain(TOKEN);
  });

  it('reprise authentifiée : lien de nouveau en ligne, révisions anciennes toujours ignorées', () => {
    const { events, socket } = online();
    socket.serverClose(1006);
    vi.advanceTimersByTime(0);
    const retry = FakeSocket.last();
    retry.open();
    retry.receive(stateFrame(0, { revision: 4 }));
    retry.receive(stateFrame(0, { revision: 7, phase: 'lobby', ready: [true, false] }));
    retry.receive(ackFrame(String(retry.sent[0]?.['requestId'])));

    expect(links(events)).toEqual(['reconnecting', 'online']);
    const revisions = events.flatMap((event) => (event.type === 'state' ? [event.state.revision] : []));
    expect(revisions).toEqual([5, 7]);
  });

  it('tentatives à 0, 1, 2, 4 s puis toutes les 4 s ; abandon à 30 s de la coupure (« lost »), plus aucune socket', () => {
    const { events, socket } = online();
    socket.serverClose(1006);
    // Première tentative aussitôt, dans la fermeture même (sans attendre une minuterie).
    expect(FakeSocket.instances).toHaveLength(2);
    const opened: number[] = [0];
    FakeSocket.last().serverClose(1006);
    for (let elapsed = 100; elapsed <= 40_000; elapsed += 100) {
      const before = FakeSocket.instances.length;
      vi.advanceTimersByTime(100);
      if (FakeSocket.instances.length > before) {
        opened.push(elapsed);
        FakeSocket.last().serverClose(1006);
      }
    }
    expect(opened.slice(0, 5)).toEqual([0, 1000, 3000, 7000, 11_000]);
    expect(opened.at(-1)).toBeLessThan(30_000);
    expect(events.filter((event) => event.type === 'ended')).toEqual([{ type: 'ended', reason: 'lost' }]);
    const count = FakeSocket.instances.length;
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(count);
  });

  it('room fermée pendant la coupure : 4404 à la reprise → « closed-while-away » ; room-closed garde son motif', () => {
    const first = online();
    first.socket.serverClose(1006);
    vi.advanceTimersByTime(0);
    FakeSocket.last().serverClose(4404);
    expect(first.events.at(-1)).toEqual({ type: 'ended', reason: 'closed-while-away' });

    FakeSocket.reset();
    const second = online();
    second.socket.serverClose(1006);
    vi.advanceTimersByTime(0);
    const retry = FakeSocket.last();
    retry.open();
    retry.receive(closedFrame('reconnect-timeout'));
    retry.serverClose(4404);
    expect(second.events.at(-1)).toEqual({ type: 'ended', reason: 'reconnect-timeout' });
  });

  it('token refusé ou place reprise ailleurs pendant la reprise : fin, sans nouvelle tentative', () => {
    const { events, socket } = online();
    socket.serverClose(1006);
    vi.advanceTimersByTime(0);
    FakeSocket.last().serverClose(4409);
    expect(events.at(-1)).toEqual({ type: 'ended', reason: 'replaced' });
    const count = FakeSocket.instances.length;
    vi.advanceTimersByTime(30_000);
    expect(FakeSocket.instances).toHaveLength(count);
  });

  it('tentative sans issue (ni ouverture ni fermeture) : abandonnée après 5 s, la suivante suit', () => {
    const { socket } = online();
    socket.serverClose(1006);
    vi.advanceTimersByTime(0);
    const hung = FakeSocket.last();
    vi.advanceTimersByTime(ATTEMPT_TIMEOUT_MS);
    expect(hung.closedByClient).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.last()).not.toBe(hung);
  });

  it('lien mort sans fermeture signalée : sans pong depuis 10 s, la socket est abandonnée et la reprise commence', () => {
    const { events, socket } = online();
    vi.advanceTimersByTime(PING_INTERVAL_MS * 2);
    expect(links(events)).toEqual([]);
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(socket.closedByClient).toBe(true);
    expect(links(events)).toEqual(['reconnecting']);
  });

  it('les pong maintiennent le lien en vie', () => {
    const { events, socket } = online();
    for (let tick = 0; tick < 6; tick += 1) {
      const ping = socket.lastSent('ping');
      socket.receive(encodeServerMessage(pongMessage(String(ping?.['requestId']), 1_000)));
      vi.advanceTimersByTime(PING_INTERVAL_MS);
    }
    expect(links(events)).toEqual([]);
    expect(socket.closedByClient).toBe(false);
  });

  it('« Réessayer » pendant l’attente : tentative immédiate ; le retour du réseau aussi', () => {
    const { connection, socket } = online();
    socket.serverClose(1006);
    vi.advanceTimersByTime(0);
    FakeSocket.last().serverClose(1006);
    const count = FakeSocket.instances.length;
    connection.retryNow();
    expect(FakeSocket.instances).toHaveLength(count + 1);
    FakeSocket.last().serverClose(1006);
    window.dispatchEvent(new Event('online'));
    expect(FakeSocket.instances).toHaveLength(count + 2);
  });

  it('« Réessayer » en ligne : resynchronisation par une nouvelle socket ; l’ancienne est fermée à l’ack et ignorée', () => {
    const { connection, events, socket } = online();
    connection.retryNow();
    expect(links(events)).toEqual(['reconnecting']);
    const fresh = FakeSocket.last();
    fresh.open();
    // Trames de l'ancienne socket (4409 du serveur compris) : ignorées.
    socket.receive(stateFrame(0, { revision: 9 }));
    socket.serverClose(4409);
    fresh.receive(stateFrame(0, { revision: 6 }));
    fresh.receive(ackFrame(String(fresh.sent[0]?.['requestId'])));
    expect(links(events)).toEqual(['reconnecting', 'online']);
    expect(events.some((event) => event.type === 'ended')).toBe(false);
    expect(events.flatMap((event) => (event.type === 'state' ? [event.state.revision] : []))).toEqual([5, 6]);
    expect(socket.closedByClient).toBe(true);
  });

  it('quitter pendant une coupure : plus aucune tentative ni événement', () => {
    const { connection, events, socket } = online();
    socket.serverClose(1006);
    connection.leave();
    const count = FakeSocket.instances.length;
    const before = events.length;
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(count);
    expect(events).toHaveLength(before);
  });
});
