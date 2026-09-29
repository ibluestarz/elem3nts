import './assets/fonts/fonts.css';
import './styles/tokens.css';
import './styles/base.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { readPreferences } from './state/preferences.ts';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Élément racine #root introuvable dans index.html.');
}

// Mouvements réduits dès l'écran d'ouverture : le choix de l'appareil prime sur la requête média (PFC-021).
document.documentElement.dataset['reducedMotion'] = String(readPreferences().reducedMotion);

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
