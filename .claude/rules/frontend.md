---
paths:
  - "src/client/**/*.{ts,tsx,css}"
---

# frontend

Le DOM porte les informations et contrôles accessibles ; Three.js ne porte aucune règle métier.
Nettoyer listeners, timers et ressources GPU, y compris sous StrictMode. Pas de setState par frame.
La première saisie est verrouillée ; ignorer repeat, champs éditables et phases incompatibles.
Ne pas intercepter deux fois l'action native Espace d'un bouton. Rendre focus et erreurs visibles.
Prévoir reduced-motion et fallback WebGL. Aucun élément adverse en DOM avant la révélation.
