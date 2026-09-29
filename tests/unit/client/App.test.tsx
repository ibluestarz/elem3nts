import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { App } from '../../../src/client/App.tsx';

describe('PFC-001-AC1 — page française minimale', () => {
  it('affiche le titre ELEM3NTS comme unique titre de niveau 1', () => {
    render(<App />);

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveAccessibleName('ELEM3NTS');
  });

  it('annonce le message d’ouverture en français via une zone de statut', () => {
    render(<App />);

    expect(screen.getByRole('status')).toHaveTextContent('Invocation de l’arène…');
  });

  it('expose un landmark principal nommé par le titre', () => {
    render(<App />);

    expect(screen.getByRole('main')).toHaveAccessibleName('ELEM3NTS');
  });

  it('se monte et se démonte sans erreur sous StrictMode', () => {
    const { unmount } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
    unmount();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('PFC-004 — passe de l’écran d’ouverture à l’accueil une fois les polices prêtes', async () => {
    render(<App />);

    expect(screen.getByRole('status')).toHaveTextContent('Invocation de l’arène…');
    expect(await screen.findByRole('button', { name: 'Jouer en local' })).toBeVisible();
    expect(screen.queryByText('Invocation de l’arène…')).not.toBeInTheDocument();
  });
});
