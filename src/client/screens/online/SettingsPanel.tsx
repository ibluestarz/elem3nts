import { useId } from 'react';
import type { MatchSettings } from '../../../domain/index.ts';
import { Switch } from '../../components/Switch.tsx';
import { TargetRow } from './TargetRow.tsx';

interface SettingsPanelProps {
  readonly settings: MatchSettings;
  /** Hôte (Joueur 1) : réglages modifiables ; invité : lecture seule. */
  readonly host: boolean;
  /** Relance le signal visuel quand l'hôte change les réglages (vue de l'invité). */
  readonly changes: number;
  /** Titre accessible du groupe. */
  readonly label: string;
  readonly className?: string;
  readonly onStep: (delta: 1 | -1) => void;
  readonly onDraw: (drawEnabled: boolean) => void;
}

/**
 * Réglages d'une room (PFC-015) : score cible et match nul, modifiables par l'hôte seul et visibles
 * des deux joueurs ; toute modification retire les confirmations (lobby et revanche, SPEC).
 */
export function SettingsPanel({ settings, host, changes, label, className, onStep, onDraw }: SettingsPanelProps) {
  const drawId = useId();
  const classes = ['lobby__settings', className, !host && changes > 0 && 'lobby__settings--changed'].filter(Boolean).join(' ');
  return (
    <div key={host ? 'host' : changes} className={classes} role="group" aria-label={label}>
      <TargetRow target={settings.target} {...(host ? { onStep } : {})} />
      <div className="lobby__draw">
        <div className="lobby__draw-text">
          <span className="lobby__draw-title">Match nul</span>
          <span className="lobby__draw-sub" id={drawId}>
            {settings.drawEnabled ? 'Deux joueurs à la cible ensemble : match nul' : 'Désactivé : l’égalité se joue en mort subite'}
          </span>
        </div>
        {host ? (
          <Switch label="Match nul" checked={settings.drawEnabled} describedBy={drawId} onChange={onDraw} />
        ) : (
          <span className="lobby__draw-value">{settings.drawEnabled ? 'Autorisé' : 'Désactivé'}</span>
        )}
      </div>
      {!host && <p className="lobby__note">Réglages choisis par Joueur 1 ; toute modification retire les confirmations.</p>}
    </div>
  );
}
