# PFC-022 — CI reproductible et déploiement staging Cloudflare

- Statut : done
- Priorité : P0
- Lot : M3
- Dépendances : PFC-020, PFC-021

## Contexte et objectif
Créer une chaîne vérifiable de build à staging sans publier à chaque modification.

## Périmètre
CI du dépôt choisi, scripts release, secrets injectés, config staging/prod isolée, déploiement staging. Exclut production automatique.

## Règles et contraintes
TESTING ordre imposé ; Static Assets + DO ; migrations explicites ; accès Cloudflare requis seulement pour publier.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| un test fonctionnel échoue en CI | la pipeline exécute les gates | aucun déploiement n’est lancé |
| l’artefact a passé verify et les secrets staging sont disponibles | le déploiement staging est demandé | deux clients peuvent créer rejoindre et terminer une partie en WSS |

## Critères d'acceptation
- [x] AC1 : CI clean exécute npm ci, build, fonctionnel, ESLint et Playwright dans cet ordre avec arrêt en échec.
- [x] AC2 : Staging sert SPA, API et WSS avec bonnes bindings ; aucun token livré au client.
- [x] AC3 : Smoke deux joueurs/reconnexion passe sur staging ; rollback et compatibilité stockage documentés.

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
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-022-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

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
- Deuxième run (d74efdb, run 36648162703) : mêmes étapes vertes, Playwright **62 échecs** ; annotations lisibles :
  22 × `visual.spec.ts` (Chromium, parité maquette à tolérance nulle : 3 000 à 9 700 pixels, ~1 %, écarts stables)
  et `a11y.spec.ts` PFC-021-S2 (contraste mesuré sur le rendu : 3,69 au lieu de ≥ 4,5) ; 39 autres non nommés (GitHub
  ne détaille que 10 erreurs par étape). Cause : références capturées sur Ubuntu 22.04 (FreeType 2.11), runner en
  24.04 (rendu des polices différent). Correctif : runner `ubuntu-22.04` (même distribution que la capture ; la
  tolérance n'est pas relâchée) ; reporter `json` + `scripts/ci-failures.ts` : liste complète des échecs en une
  annotation publique.
- Troisième run (2cd49fd, run 36650584121, ubuntu-22.04) : parité visuelle et contraste désormais verts ; liste
  publique : **32 échecs, tous Firefox**, même cause : sans serveur d'affichage, Firefox headless n'a pas de WebGL2 et
  journalise « Failed to create WebGL context … AllowWebgl2:false », compté par `trackProblems` (le jeu, lui, se
  replie correctement). Reproduit en local en retirant `DISPLAY`/`WAYLAND_DISPLAY` (smoke.spec:9 et worker.spec:46
  en échec, même avertissement) ; `webgl.force-enabled` n'y change rien ; sous `xvfb-run -a` : 9/9 verts. Correctif :
  étape E2E de la CI sous `xvfb-run -a` (le poste de référence, WSLg, a un affichage).
- Quatrième run (97b5a60, run 36654697804, xvfb) : **1 échec sur 306**, `performance.spec.ts:75` (PFC-021-AC3, 20
  revanches) : 175 écouteurs contre ≤ 174. Non reproduit en local dans les conditions de la CI (sans affichage,
  xvfb-run, 2 cœurs par `taskset`) : 4/4 verts, 174 écouteurs aux revanches 2, 10 et 20 (aucune croissance par
  partie ; une fuite en donnerait ~+18). Écouteur éphémère compté à l'instant de la mesure sous charge : écouteurs
  et nœuds re-mesurés (GC + une image) jusqu'au retour au niveau initial, 10 s au plus ; une fuite échoue toujours.
  La liste publique des échecs inclut désormais les mesures annotées du test. Test modifié : 9/9 verts (3 × 3).
- Cinquième run (c913ba1, run 36657980715) : test de fuite vert (re-mesure : élément éphémère confirmé) ; 1 échec,
  `a11y.spec.ts` PFC-021-S2, contraste du raccourci de l'accueil 3,88 < 4,5 (déjà 3,69 au run 24.04, vert aux runs
  2cd49fd, 97b5a60, 86b435a). Local strictement déterministe : 11,99 (texte) et 5,77 (touche) sur 12 passages sous
  charge ; hypothèses écartées par expérience : polices retardées de 1,5 s (vert), phase d'animation (seule
  `screen-enter`, 10 ms). Diagnostic ajouté : en CI et en échec seulement, mesures et extrait JPEG de la zone publiés
  en annotation (éprouvé en local : 4,7 ko, image lisible).
- Sixième run (c821df2, run 36660311578) : même échec, mesures publiées : texte 3,88 (11,99 en local), touche 5,32
  (5,77), même position. Hypothèse : la capture du fond (textes masqués par une feuille adoptée) reprend en CI une
  image antérieure au masquage ; les pixels des glyphes comptent alors comme fond. Le diagnostic publie désormais
  l'extrait de cette capture (découpé sous la limite de 4 096 caractères ; en local : textes bien masqués).
- Septième run (14ea0eb, run 36662299940) : capture du fond publiée par la CI : **textes encore visibles** alors que
  la feuille qui les masque est appliquée → hypothèse confirmée (image antérieure au masquage sous rendu logiciel
  chargé). Défaut du test, pas de l'application. Correctif dans `measureTextContrast` : capture retenue différente de
  l'image avec textes, puis stable sur deux prises (borné) ; diagnostic retiré. `a11y.spec.ts` : 33/33 sur les trois
  navigateurs dans les conditions de la CI.
- **CI GitHub verte** : run 36664480250 sur 40b5e6d (ubuntu-22.04) : build, fonctionnel, ESLint, Playwright trois
  navigateurs ; job `deploy-staging` sauté (pas de `workflow_dispatch`), comme prévu.
- **Staging publié (2026-09-30, accès `wrangler login` du propriétaire, publication autorisée)** : depuis une
  extraction propre de 40b5e6d avec l'artefact vérifié (`CLOUDFLARE_ENV=staging`, recette complète verte sur l'arbre
  identique d'86b435a ; aucun fichier applicatif modifié entre les deux commits, `git diff --name-only` vide),
  `npm run deploy:staging` : Worker `elem3nts-staging`, version **a9be4c1a-cab0-4744-a3f3-891858638e5b**, tag
  `40b5e6dd573e`, message `staging 40b5e6dd573e2af5f037bc53eac2a1b0f5b912b8` (`wrangler deployments list`), liaisons
  ROOMS et LIMITER. https://elem3nts-staging.elem3nts.workers.dev : HTTP 200, CSP, HSTS, `X-Frame-Options: DENY`,
  `nosniff`, `no-referrer`, COOP ; `/p/ABCDEFGH` → 200 `text/html` (repli SPA) ; `/api/inconnue` → 404 JSON.
- **Smoke staging** (`SMOKE_URL=https://elem3nts-staging.elem3nts.workers.dev npm run test:smoke`) : **2 passed
  (22,5 s)** : deux clients, création, lien d'invitation, WSS de même origine, rechargement et reprise de la manche,
  victoire et trophée, revanche, aucun choix adverse avant révélation, aucun token dans URL ni console ; en-têtes.
- Rollback et compatibilité du stockage : docs/RUNBOOK.md « Déployer et revenir en arrière ».
- Limites : le job CI `deploy-staging` (workflow_dispatch) n'a pas encore été déclenché (aucun jeton GitHub ici) ;
  la publication a suivi la même procédure en local. Avant le premier push, la CI était prouvée sur copies propres
  (choix initial du propriétaire : preuve locale, aucun commit ni push) ; `sudo npx
  playwright install-deps` non relancé (dépendances déjà présentes) ; sur GitHub, `install --with-deps` s'en charge.
  - Arbre principal, `npm run verify` (cible production, sans `CLOUDFLARE_ENV`) : EXIT 0 ; Vitest 805/805 ; Playwright
    288 passed, 18 skipped (14,8 min).
- Blocages / décisions nouvelles : D48. Blocage d'accès Cloudflare levé (`wrangler login`, 2026-09-30) ; aucun blocage restant.
