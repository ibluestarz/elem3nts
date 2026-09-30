# PFC-023 — Recette finale et mise en production

- Statut : done
- Priorité : P0
- Lot : M3
- Dépendances : PFC-022

## Contexte et objectif
Livrer une version traçable qui couvre toutes les notes initiales.

## Périmètre
Recette complète, documentation joueur/exploitation, release et smoke production. Exclut toute nouvelle fonction.

## Règles et contraintes
Tous les critères MVP de TRACEABILITY couverts ; publication seulement sur demande explicite ; statut honnête si accès manquant.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| staging a passé la recette et la publication production est autorisée | l’artefact vérifié est publié | les parcours local et room privée passent le smoke production |
| une régression de double trophée est détectée en recette | la release est évaluée | la livraison est bloquée et un ticket correctif traçable est créé |

## Critères d'acceptation
- [x] AC1 : 23 tickets évalués et aucune exigence MVP sans preuve ; aucun bug bloquant accepté silencieusement.
- [x] AC2 : Build fonctionnel lint Playwright verts depuis clone propre ; local/en ligne, nul ON/OFF et trophées validés.
- [x] AC3 : Version et procédure rollback enregistrées ; après publication autorisée, smoke production deux clients concluant.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Recette finale et mise en production
  Scénario: PFC-023-S1 — Release vérifiée
    Étant donné staging a passé la recette et la publication production est autorisée
    Quand l’artefact vérifié est publié
    Alors les parcours local et room privée passent le smoke production
  Scénario: PFC-023-S2 — Régression bloquante
    Étant donné une régression de double trophée est détectée en recette
    Quand la release est évaluée
    Alors la livraison est bloquée et un ticket correctif traçable est créé
```

## Tests et vérification
Checklist TRACEABILITY, npm ci + verify, smoke staging/production, logs expurgés et référence d’artefact. Documenter sans prétendre publier si autorisation ou accès absent.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-023-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Plan (2026-09-30) : configuration de production, smoke local ajouté, documentation joueur/exploitation, évaluation
  des tickets, preuve S2 par mutation, version 1.0.0, gates complets, CI GitHub, staging, production, smoke, tag.
  Publication de production autorisée explicitement par le propriétaire (2026-09-30 : « lancer la 23 sans me
  demander quoi que ce soit, je te fais confiance pour la clôturer comme il faut »).
- AC1 — évaluation des tickets (statut dans chaque fichier, preuves dans docs/TRACEABILITY.md) :

  | Tickets | Statut | Preuve |
  | --- | --- | --- |
  | PFC-001 à PFC-021, PFC-024 à PFC-026 | done | lignes PFC-0xx de TRACEABILITY ; 80 chemins de preuve cités, tous présents |
  | PFC-022 | done | CI GitHub verte (run 36664480250), staging publiée, smoke 2/2 |
  | PFC-023 | ce ticket | ci-dessous |
  | PFC-027 | todo, hors livraison | P2 « non requise pour la release » (son ticket, D46) ; limite connue : compilation des shaders à l'ouverture |

  Les 24 besoins initiaux de la matrice ont chacun des tickets et des tests ; une référence périmée corrigée
  (`tests/tooling/engine-port.test.ts`). Aucun bug bloquant connu.
- Implémentation :
  - `wrangler.jsonc` : production explicite (`workers_dev: true`, `preview_urls: false`) ; `scripts/deploy-target.ts` :
    URL de production ; `tests/integration/config.test.ts` : test PFC-023.
  - `tests/smoke/deployed.spec.ts` (ex-`staging.spec.ts`) : parcours local ajouté (clavier partagé, vraie scène,
    victoire, trophée, revanche) ; vert contre staging (1/1 ; suite complète 3/3 sous xvfb sans affichage).
  - Version 1.0.0 (`package.json`, `package-lock.json`, champs `version` seuls).
  - Documentation : README réécrit (jouer, commandes, développer, livrer) ; RUNBOOK « Livrer en production » et
    « Régression détectée pendant la recette », offre Cloudflare revérifiée (inchangée) ; D50 ; TESTING (commandes,
    Release) ; ARCHITECTURE (URL de production) ; TRACEABILITY (PFC-023).
- S2 — régression « trophée doublé » (`scratchpad/release-red.sh`, copie propre, mutation dans `src/domain/session.ts`,
  séquence build → fonctionnel → ESLint → E2E → publication) :
  - M1, garde de doublon retirée : build vert, **fonctionnel rouge (5 échecs, dont les 4 « attribution unique par
    matchId » PFC-003-AC3)**, ESLint et E2E sautés, publication non lancée.
  - M2, +2 par victoire : **fonctionnel rouge (23 échecs : PFC-006, PFC-007…)**, publication non lancée.
  - Ticket correctif : procédure RUNBOOK (aucune régression réelle constatée, donc aucun ticket créé).
- Recette du candidat e1cb17a : copie propre dans les conditions de la CI (staging) : build ; Vitest 844/844 ; ESLint ;
  Playwright 307 passed, 18 skipped ; CI GitHub verte (run 36668295480). Mais `npm run verify` de production sur
  extraction propre : **1 échec**, `performance.spec.ts:75` : +1 programme WebGL et +1 VAO entre les revanches 10 et 20
  (65→66, 261→262). **Livraison arrêtée** (procédure S2) le temps d'établir la cause : 4/4 verts dans le même
  environnement (54/227 → 65/261 → 65/261) ; variante à 40 revanches sous charge, 2/2 : 65 programmes et 261 VAO de la
  10e à la 40e, écouteurs 174, nœuds 175, tas +0,3 Mo : aucune fuite, recompilation unique de D46 arrivée après la
  10e partie. Assertion ajustée : au plus une unité d'écart entre la 10e et la 20e revanche (une fuite par partie en
  donne ≥ 10) ; éprouvée : 2/2 verts, écart injecté de +2 détecté. Livraison reprise depuis le commit du correctif.
- **Livraison 1.0.0 (commit `8d51cdc`, 2026-09-30)**, procédure RUNBOOK « Livrer en production » :
  1. CI GitHub verte sur 8d51cdc (run 36671245261 : build, fonctionnel, ESLint, Playwright trois navigateurs).
  2. Staging : extraction propre de 8d51cdc, artefact staging vérifié (aucun fichier applicatif modifié depuis
     e1cb17a, dont la recette complète était verte), `npm run deploy:staging` → version
     `7c6c01d6-b8e7-4ded-91f6-00060460cf84` ; smoke staging **3/3** (room privée à deux clients, en-têtes et API,
     parcours local avec la vraie scène).
  3. Extraction propre de 8d51cdc (`git worktree`, `npm ci`), `CI=true npm run verify` (production, sans
     `CLOUDFLARE_ENV`) : **EXIT 0** ; Vitest 52 fichiers, 844/844 ; ESLint ; Playwright 307 passed, 18 skipped
     (14,5 min) ; artefact `elem3nts`, `workers_dev: true`, `preview_urls: false` ; arbre propre.
  4. `npm run deploy:production` : Worker `elem3nts`, version **`c9a52b2a-cf54-423e-a7c2-0ca55028c5ce`**, tag
     `8d51cdca251d`, message `production 8d51cdca251deb0334c73462e61b838e7f798ce6` (`wrangler deployments list`,
     100 % du trafic) ; https://elem3nts.elem3nts.workers.dev : HTTP 200, CSP, HSTS, `DENY`, `nosniff`,
     `no-referrer`, COOP ; `/p/ABCDEFGH` → 200 `text/html` ; `/api/inconnue` → 404 JSON.
  5. Smoke de production (`SMOKE_URL=https://elem3nts.elem3nts.workers.dev npm run test:smoke`) : **3/3** (1,4 min).
  6. Tag git `v1.0.0` sur 8d51cdc ; version et retour arrière consignés dans docs/RUNBOOK.md « Versions publiées ».
- AC2 : gates verts depuis extraction propre (point 3) et CI GitHub (point 1) ; local et en ligne, nul ON/OFF et
  trophées validés par `tests/e2e/rematch.spec.ts` (série, nul ON), `tests/e2e/local.spec.ts` (nul OFF, X = 1 et 10),
  `tests/e2e/online.spec.ts`, `tests/e2e/network.spec.ts` (trophées en ligne), et par les smokes.
- Limites : PFC-027 (P2) non livré ; première production, donc pas de version antérieure pour un retour arrière
  (conduite en cas d'incident dans le RUNBOOK) ; job CI `deploy-staging` non encore déclenché depuis GitHub (aucun
  jeton ici), publications faites en local selon la même procédure ; le propriétaire peut révoquer l'accès OAuth de
  ce poste (`npx wrangler logout`).
- Blocages / décisions nouvelles : D50 ; aucun blocage restant.
