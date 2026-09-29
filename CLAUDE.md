# Feu · Eau · Plante — instructions projet

## Mission
Développer un duel web à deux joueurs, local sur un clavier ou en room privée WebSocket.
Stack imposée : TypeScript strict, React, Vite, Three.js, Autoprefixer, ESLint,
Playwright Microsoft ; Cloudflare Workers pour le déploiement.
Le kit contient les spécifications et le backlog, pas encore l'application.

## Lire juste ce qui est nécessaire
- Première session : `README.md`, `docs/SPEC.md`, `docs/DECISIONS.md`, `tasks/README.md`.
- Avant un ticket : son fichier, ses dépendances, puis les sections pertinentes de
  `docs/ARCHITECTURE.md`, `docs/PROTOCOL.md` et `docs/TESTING.md`.
- Règles spécialisées : `.claude/rules/`. Ne pas charger tous les tickets à chaque session.
- Les choix par défaut de `docs/DECISIONS.md` s'appliquent jusqu'à modification explicite.
  Ne pas rouvrir les mêmes questions à chaque ticket ; ne pas les présenter comme validés par le propriétaire.

## Exécuter
1. Choisir le premier ticket `todo` dont les dépendances sont `done` ; un seul `in_progress`.
2. Lire le code existant et les tests, écrire un plan court pour les changements transversaux.
3. Implémenter seulement le périmètre du ticket avec ses scénarios ; éviter les refontes annexes.
4. Vérifier le comportement, mettre à jour les preuves et le statut du ticket.
5. Résumer résultat, commandes réellement exécutées, limites et prochain ticket disponible.
Ne jamais annoncer un test ou un déploiement réussi sans l'avoir exécuté.

## Invariants
- Un seul moteur métier pur, partagé entre local et serveur. Aucun score calculé par Three.js.
- En ligne, seul le serveur décide des scores, phases, échéances et trophées.
- Aucun choix adverse transmis avant la révélation. Jamais de token dans les logs.
- Une manche et une récompense de partie ne s'appliquent qu'une seule fois.
- Ne pas créer comptes, matchmaking public, bots, boutique ou classement global dans ce MVP.

## Commandes (créées par PFC-001)
`npm ci`, `npm run dev`, `npm run build`, `npm run test:functional`,
`npm run lint`, `npm run test:e2e`, `npm run verify`.
Ordre du gate : build (inclut typecheck) → fonctionnel → ESLint → Playwright.
Contrat et couverture actuelle (dev, preview et E2E sur le Worker local depuis PFC-011) : `docs/TESTING.md`.
Node : `nvm use` (`.nvmrc`). E2E : navigateurs Playwright et `sudo npx playwright install-deps`.

## Git et compétences
- `/commit PFC-xxx` : commit local ciblé, contrôle de l'index et preuves de vérification.
- `/create-ticket <besoin>` : création d'un ticket atomique à partir du modèle.
- Pas de push, déploiement, amend ou réécriture d'historique sans instruction correspondante.
- Ne pas écraser les modifications préexistantes. Ne pas committer de secrets.
- Conserver lors d'une compaction : ticket actif, décisions, fichiers modifiés, preuves et blocages.
