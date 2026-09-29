---
paths:
  - "src/domain/**/*.ts"
  - "tests/unit/**/*.ts"
---

# domain

Lire docs/SPEC.md avant de toucher au moteur. Tous les deltas utilisent les scores avant manche.
Appliquer les scores atomiquement avant d'évaluer la victoire. Plancher zéro, aucun plafond à X.
Le domaine reste pur et déterministe : temps et identifiants injectés, aucune API d'environnement.
Partager exactement ce moteur avec le mode local et le serveur. Tester symétrie et cas limites.
Ne pas remplacer les effets d'éléments identiques par un match nul standard.
