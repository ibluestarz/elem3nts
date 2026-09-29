import './Switch.css';

interface SwitchProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly describedBy?: string;
  readonly disabled?: boolean;
}

/** Interrupteur de la maquette, exposé comme `switch` ARIA (état annoncé, activable à l'Espace). */
export function Switch({ label, checked, onChange, describedBy, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      className={checked ? 'switch switch--on' : 'switch'}
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span className="switch__knob" aria-hidden="true" />
    </button>
  );
}
