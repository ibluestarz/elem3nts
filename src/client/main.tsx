import './assets/fonts/fonts.css';
import './styles/tokens.css';
import './styles/base.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Élément racine #root introuvable dans index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
