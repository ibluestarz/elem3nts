---
paths:
  - "src/worker/**/*.ts"
  - "src/shared/**/*.ts"
  - "wrangler*.jsonc"
---

# network

Lire docs/PROTOCOL.md. Authentifier la place côté socket et valider tous les messages à l'exécution.
Le serveur seul résout manches et récompenses ; persister avant publication, transitions idempotentes.
Projeter l'état par allowlist. Aucun token, hash ou choix caché dans snapshots, logs ou erreurs.
Ne pas utiliser la mémoire globale Worker comme autorité de room, rate limit ou réservation.
Tester réveil/alarme/reconnexion et messages obsolètes. Garder les API hors du fallback SPA.
