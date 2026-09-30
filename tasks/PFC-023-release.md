# PFC-023 — Recette finale et mise en production

- Statut : in_progress
- Priorité : P0
- Lot : M3
- Dépendances : PFC-022

## Contexte et objectif
Livrer une version traçable qui couvre toutes les notes initiales.

## Périmètre
Recette complète, documentation joueur/exploitation, release et smoke production. Exclut toute nouvelle fonction.

## Règles et contraintes
Tous les critères MVP de TRACEABILITY couverts ; publication seulement sur demande explicite ; statut honnête si accès manquant.
Références : [SPEC](../docs/SPEC.md), [décisions](../docs/DECISIONS.md),
[architecture](../docs/ARCHITECTURE.md), [protocole](../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| staging a passé la recette et la publication production est autorisée | l’artefact vérifié est publié | les parcours local et room privée passent le smoke production |
| une régression de double trophée est détectée en recette | la release est évaluée | la livraison est bloquée et un ticket correctif traçable est créé |

## Critères d'acceptation
- [ ] AC1 : 23 tickets évalués et aucune exigence MVP sans preuve ; aucun bug bloquant accepté silencieusement.
- [ ] AC2 : Build fonctionnel lint Playwright verts depuis clone propre ; local/en ligne, nul ON/OFF et trophées validés.
- [ ] AC3 : Version et procédure rollback enregistrées ; après publication autorisée, smoke production deux clients concluant.

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
- [ ] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [ ] Scénarios PFC-023-S1 et S2 traduits en tests appropriés et exécutés.
- [ ] [DoD commune](../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [ ] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [ ] Suivi ci-dessous rempli et statut mis à jour.

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
- Commandes exécutées / résultats : à compléter (gates, CI, staging, production).
- Blocages / décisions nouvelles : D50.
