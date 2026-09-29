import './Keycap.css';

interface KeycapProps {
  readonly label: string;
  /** `arena` ajoute le fond sombre des légendes posées sur la scène. */
  readonly variant?: 'panel' | 'arena';
}

/** Touche de clavier dessinée (maquette : légendes de la préparation et de l'arène). */
export function Keycap({ label, variant = 'panel' }: KeycapProps) {
  return <kbd className={variant === 'arena' ? 'keycap keycap--arena' : 'keycap'}>{label}</kbd>;
}
