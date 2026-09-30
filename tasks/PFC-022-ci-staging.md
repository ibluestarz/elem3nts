# PFC-022 — CI reproductible et déploiement staging Cloudflare

- Statut : blocked
- Priorité : P0
- Lot : M3
- Dépendances : PFC-020, PFC-021

## Contexte et objectif
Créer une chaîne vérifiable de build à staging sans publier à chaque modification.

## Périmètre
CI du dépôt choisi, scripts release, secrets injectés, config staging/prod isolée, déploiement staging. Exclut production automatique.

## Règles et contraintes
TESTING ordre imposé ; Static Assets + DO ; migrations explicites ; accès Cloudflare requis seulement pour publier.
Références : [SPEC](../docs/SPEC.md), [décisions](../docs/DECISIONS.md),
[architecture](../docs/ARCHITECTURE.md), [protocole](../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| un test fonctionnel échoue en CI | la pipeline exécute les gates | aucun déploiement n’est lancé |
| l’artefact a passé verify et les secrets staging sont disponibles | le déploiement staging est demandé | deux clients peuvent créer rejoindre et terminer une partie en WSS |

## Critères d'acceptation
- [x] AC1 : CI clean exécute npm ci, build, fonctionnel, ESLint et Playwright dans cet ordre avec arrêt en échec.
- [ ] AC2 : Staging sert SPA, API et WSS avec bonnes bindings ; aucun token livré au client.
- [ ] AC3 : Smoke deux joueurs/reconnexion passe sur staging ; rollback et compatibilité stockage documentés.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: CI reproductible et déploiement staging Cloudflare
  Scénario: PFC-022-S1 — Gate rouge
    Étant donné un test fonctionnel échoue en CI
    Quand la pipeline exécute les gates
    Alors aucun déploiement n’est lancé
  Scénario: PFC-022-S2 — Staging prêt
    Étant donné l’artefact a passé verify et les secrets staging sont disponibles
    Quand le déploiement staging est demandé
    Alors deux clients peuvent créer rejoindre et terminer une partie en WSS
```

## Tests et vérification
Pipeline et npm run verify local ; smoke réel staging, version publiée et preuve URL. Si secrets absents : ticket blocked, conserver config prête et contrôles locaux.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [ ] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [ ] Scénarios PFC-022-S1 et S2 traduits en tests appropriés et exécutés.
- [ ] [DoD commune](../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [ ] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [ ] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation (2026-09-29/30, D48) :
  - `wrangler.jsonc` : racine = production `elem3nts` ; `env.staging` = Worker `elem3nts-staging` sur
    https://elem3nts-staging.elem3nts.workers.dev (`workers_dev`, `preview_urls: false`), liaisons et migrations
    répétées à l'identique (non héritées), aucune variable.
  - `.github/workflows/ci.yml` : `verify` (`CLOUDFLARE_ENV=staging`, `npm ci`, navigateurs, build → fonctionnel →
    ESLint → Playwright en étapes distinctes, artefact `dist-staging` 7 j, rapport seulement en échec) ;
    `deploy-staging` (`needs: verify`, `workflow_dispatch` + `deploy_staging` + `main`, environnement `staging`,
    concurrence sérialisée) : artefact téléchargé **sans rebuild**, `npm run deploy:staging`, smoke. Actions figées par
    commit, `contents: read`, `persist-credentials: false`, secrets dans la seule étape de publication.
  - `scripts/deploy.ts` + `scripts/deploy-target.ts` : `npm run deploy:staging|production` publie l'artefact vérifié
    (`wrangler deploy --config dist/elem3nts/wrangler.json --strict --tag <sha12> --message "<cible> <sha>"`), refuse
    un artefact d'une autre cible ; production refusée sur arbre modifié. Aucun jeton lu ni affiché.
  - `playwright.smoke.config.ts` + `tests/smoke/staging.spec.ts` (`npm run test:smoke`, `SMOKE_URL` obligatoire, HTTPS
    hors machine locale, pas d'IP usurpée, pas de trace) ; `playerIn(context)` extrait de `tests/e2e/online-driver.ts`.
  - Tests : `tests/tooling/ci.test.ts` (S1 structurel + garde), `tests/integration/config.test.ts` (staging isolé).
  - Docs : ARCHITECTURE « Environnements, CI et livraison », DECISIONS D48, TESTING (commandes, « CI et staging »),
    RUNBOOK « Déployer et revenir en arrière » (rollback, migrations DO, compatibilité `schema_version`), TRACEABILITY,
    SOURCES, README.
- Remises en cause appliquées (lentille senior) : l'environnement wrangler est fixé **au build** par le plugin Vite →
  l'artefact vérifié est propre à sa cible et publié sans rebuild (un `wrangler deploy --env` est refusé avec la
  configuration redirigée et publierait autre chose que le testé) ; publication staging à la demande et non à chaque
  push (objectif du ticket) ; garde de cible contre l'écrasement d'un environnement ; smoke sans `CF-Connecting-IP`
  usurpé ni trace contenant des tokens réels.
- Écarts trouvés par la copie propre et corrigés :
  - `CLOUDFLARE_ENV` est lu par défaut par wrangler, y compris `unstable_readConfig` : `config.test.ts` lisait staging
    comme production → neutralisé dans le test ; `network.spec.ts` (PFC-019-AC3) imposait le nom `elem3nts` → accepte
    le Worker de la cible construite. Règle ajoutée à TESTING : gate vert avec et sans `CLOUDFLARE_ENV`.
  - Deux courses E2E révélées sous charge (aucune liée au code du ticket) : `security.spec.ts` PFC-020-AC3 (trace :
    `goto` 0,7 s puis `getAttribute` bloqué 29 s, fil principal pris par la compilation des shaders de la vraie scène,
    cf. PFC-027) → script d'entrée lu dans la réponse HTTP ; `lobby.spec.ts` PFC-015-AC1 (WebKit : chemin vérifié sans
    attente alors que `/p/CODE` est retiré par un effet) → `expect.poll`.
  - Fins de ligne : un export de l'index sur ce poste (`core.autocrlf=true` global) sortait en CRLF → `config.test.ts`
    (`.gitignore` lu ligne à ligne) et `engine-port.test.ts` échouaient ; un clone propre local aurait échoué de même.
    `.gitattributes` `* text=auto eol=lf` (aucun fichier stocké modifié : tout le texte est déjà LF) + test de garde.
- Commandes exécutées / résultats :
  - `CLOUDFLARE_ENV=staging npx vite build` puis `npx wrangler deploy -c dist/elem3nts/wrangler.json --dry-run --tag
    --message` : artefact `elem3nts-staging` (`targetEnvironment: staging`), liaisons ROOMS/LIMITER, rien publié.
  - `SMOKE_URL=http://localhost:4173 npm run test:smoke` contre `npm run preview` de l'artefact staging : 2 passed (20,6 s).
  - `npx vitest run tests/tooling/ci.test.ts` : 7 mutations du workflow (ordre lint/E2E, `needs` retiré, déploiement à
    chaque push, `|| true`, action non figée, secret dans `verify`, rebuild avant publication) toutes détectées, fichier
    restauré à l'identique (`cmp`).
  - Copie propre de l'arbre (fichiers suivis et non ignorés, sans `node_modules`/`dist`/`.wrangler`), étapes du job
    `verify` avec `CI=true CLOUDFLARE_ENV=staging` (Node 24.21.0, npm 11.19.0) : run 1 EXIT 1 (config.test), run 2
    EXIT 1 (network.spec ×3), run 3 EXIT 1 (2 courses E2E), **run 4 EXIT 0** : build 11 s ; Vitest 51 fichiers,
    805 tests ; ESLint ; Playwright 288 passed, 18 skipped (15,1 min) ; artefact `elem3nts-staging staging`.
  - S1 (`scratchpad/ci-red.sh`) : copie propre, assertion cassée volontairement dans `config.test.ts`, même séquence →
    `test:functional` 1 failed / 804 passed, lint et E2E sautés, `::deploy:: non lancé (needs: verify)`.
- Premier run GitHub Actions (push 00ee498, run 36645895790, ubuntu-24.04) : checkout, Node, `npm ci`, navigateurs,
  build, fonctionnel et ESLint verts ; **Playwright en échec après 21 min** ; artefact non publié et job
  `deploy-staging` sauté (S1 constaté en réel). Journaux illisibles sans authentification GitHub : reporter `github`
  ajouté en CI (chaque échec devient une annotation publique du run) pour diagnostiquer au run suivant.
- Limites (avant le push) : CI non exécutée sur GitHub (choix du propriétaire : preuve locale, aucun commit ni push) ; `sudo npx
  playwright install-deps` non relancé (dépendances déjà présentes) ; sur GitHub, `install --with-deps` s'en charge.
  - Arbre principal, `npm run verify` (cible production, sans `CLOUDFLARE_ENV`) : EXIT 0 ; Vitest 805/805 ; Playwright
    288 passed, 18 skipped (14,8 min).
- Blocages / décisions nouvelles : D48. **Bloqué sur l'accès Cloudflare** : publication staging autorisée par le
  propriétaire (2026-09-29), mais `npx wrangler whoami` → « You are not authenticated » ; aucun déploiement effectué.
  AC1 prouvé localement ; AC2 (staging servi) et AC3 (smoke staging) sans preuve réelle, donc non cochés.
  Reprise, au choix : (a) le propriétaire lance `npx wrangler login`, puis `CLOUDFLARE_ENV=staging npm run verify`
  (ou l'artefact vérifié du run 4), `npm run deploy:staging`,
  `SMOKE_URL=https://elem3nts-staging.elem3nts.workers.dev npm run test:smoke`, `curl -sI` des en-têtes, version et
  URL consignées ici ; (b) après `/commit` et push autorisés : Actions → CI → Run workflow (`main`, `deploy_staging`).
