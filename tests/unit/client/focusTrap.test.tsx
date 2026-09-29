import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { useFocusTrap } from '../../../src/client/hooks/useFocusTrap.ts';

/** Dialogue rendu `null` tant qu'il est fermé, comme « Connexion interrompue » (PFC-017). */
function LateDialog({ open }: { readonly open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);
  return (
    <>
      <button type="button">Derrière</button>
      {open && (
        <div role="dialog" aria-label="Dialogue" ref={ref}>
          <h2 tabIndex={-1}>Titre</h2>
          <button type="button">Premier</button>
          <button type="button">Dernier</button>
        </div>
      )}
    </>
  );
}

const tab = (shiftKey = false) => {
  // Le piège agit au keydown ; jsdom ne déplace pas le focus seul : seul l'effet du piège est observé.
  return fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', code: 'Tab', shiftKey });
};

describe('PFC-021 — piège de focus des dialogues', () => {
  it('s’attache à un dialogue monté après le premier rendu (régression « Connexion interrompue »)', () => {
    const view = render(<LateDialog open={false} />);
    view.rerender(<LateDialog open />);

    screen.getByRole('button', { name: 'Dernier' }).focus();
    expect(tab()).toBe(false);
    expect(screen.getByRole('button', { name: 'Premier' })).toHaveFocus();
    expect(tab(true)).toBe(false);
    expect(screen.getByRole('button', { name: 'Dernier' })).toHaveFocus();
  });

  it('depuis le titre focalisé à l’ouverture, Maj+Tab et Tab restent dans le dialogue', () => {
    render(<LateDialog open />);
    const title = screen.getByRole('heading', { name: 'Titre' });

    title.focus();
    tab(true);
    expect(screen.getByRole('button', { name: 'Dernier' })).toHaveFocus();
    title.focus();
    tab();
    expect(screen.getByRole('button', { name: 'Premier' })).toHaveFocus();
  });

  it('laisse Tab natif entre deux contrôles intérieurs et se retire à la fermeture', () => {
    const view = render(<LateDialog open />);
    screen.getByRole('button', { name: 'Premier' }).focus();
    expect(tab()).toBe(true);

    view.rerender(<LateDialog open={false} />);
    screen.getByRole('button', { name: 'Derrière' }).focus();
    expect(tab()).toBe(true);
    expect(screen.getByRole('button', { name: 'Derrière' })).toHaveFocus();
  });
});
