import type { MatchSettings, PlayerIndex } from '../../../domain/index.ts';
import type { PublicState } from '../../../shared/protocol/index.ts';
import { PLAYER_NAMES } from '../../input/keys.ts';
import { SettingsPanel } from './SettingsPanel.tsx';

interface LobbyProps {
  readonly state: PublicState;
  readonly slot: PlayerIndex;
  readonly settings: MatchSettings;
  readonly compact: boolean;
  readonly syncing: boolean;
  readonly readyPending: boolean;
  /** Relance le signal visuel quand l'hôte change les réglages (vue de l'invité). */
  readonly settingsChanges: number;
  readonly onStep: (delta: 1 | -1) => void;
  readonly onDraw: (drawEnabled: boolean) => void;
  readonly onReady: () => void;
}

interface ReadyView {
  readonly label: string;
  readonly hint: boolean;
  readonly blocked: boolean;
  readonly done: boolean;
}

/**
 * Lobby synchronisé (PFC-015) : réglages de l'hôte (modifiables par lui seul, visibles des deux),
 * présence et confirmation de chaque joueur. Deux confirmations lancent la même partie (D12).
 */
export function Lobby(props: LobbyProps) {
  const { state, slot, settings, compact, syncing, readyPending, settingsChanges, onStep, onDraw, onReady } = props;
  const host = slot === 0;
  const other: PlayerIndex = slot === 0 ? 1 : 0;
  const opponent = PLAYER_NAMES[other];
  const ready = readyView(state, slot, opponent, syncing, readyPending);

  return (
    <>
      <SettingsPanel
        settings={settings}
        host={host}
        changes={settingsChanges}
        label="Réglages de la partie"
        onStep={onStep}
        onDraw={onDraw}
      />

      <ul className="lobby__players" aria-label="Joueurs" aria-live="polite">
        {PLAYER_NAMES.map((name, player) => {
          const connected = state.connected[player] ?? false;
          const isReady = state.ready[player] ?? false;
          const status = !connected ? 'Déconnecté' : isReady ? 'Prêt' : 'Pas encore prêt';
          const modifier = !connected ? ' lobby__player--away' : isReady ? ' lobby__player--ready' : '';
          return (
            <li key={name} className={`lobby__player${modifier}`}>
              <span className="lobby__gem" aria-hidden="true" />
              <span className="lobby__name">
                {name}
                {player === slot && <span className="lobby__you"> · vous</span>}
                {player === 0 && <span className="lobby__role"> · hôte</span>}
              </span>
              <span key={status} className="lobby__status">
                {status}
              </span>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className={ready.done ? 'btn-gold lobby__ready lobby__ready--done' : 'btn-gold lobby__ready'}
        aria-disabled={ready.blocked}
        aria-busy={readyPending}
        onClick={onReady}
      >
        <span key={ready.label} className="lobby__ready-label">
          {ready.done && <span className="lobby__check" aria-hidden="true" />}
          {ready.label}
        </span>
        {ready.hint && !compact && <span className="btn-gold__hint">· Espace</span>}
      </button>
    </>
  );
}

function readyView(state: PublicState, slot: PlayerIndex, opponent: string, syncing: boolean, pending: boolean): ReadyView {
  if (state.ready[slot]) return { label: `Prêt — en attente de ${opponent}`, hint: false, blocked: true, done: true };
  if (pending) return { label: 'Confirmation…', hint: false, blocked: true, done: false };
  if (!state.connected[0] || !state.connected[1]) return { label: `En attente de ${opponent}`, hint: false, blocked: true, done: false };
  if (syncing) return { label: 'Envoi des réglages…', hint: false, blocked: true, done: false };
  return { label: 'Prêt', hint: true, blocked: false, done: false };
}
