---
paths:
  - "tests/**/*"
  - "package.json"
  - "*config*"
  - ".github/workflows/*"
---

# quality

Suivre docs/TESTING.md : build incluant typecheck, fonctionnel, ESLint, puis Playwright.
Tester le multijoueur avec deux contextes indépendants et le Worker local réel.
Pas de waitForTimeout arbitraire pour synchroniser les E2E, pas de tests ignorés pour verdir la CI.
Les tests citent PFC-xxx et le scénario. Ne jamais marquer une exécution non réalisée comme réussie.
Conserver la configuration Browserslist exacte ; documenter séparément la cible JS de Vite.
