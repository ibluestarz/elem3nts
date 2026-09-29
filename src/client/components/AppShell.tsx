import type { ReactNode } from 'react';
import './AppShell.css';

interface AppShellProps {
  readonly children: ReactNode;
}

/** Cadre commun à tous les écrans : reprend la structure `appRef` de la maquette. */
export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <div className="app-stage">{children}</div>
    </div>
  );
}
