# PFC-023 — Recette finale et mise en production

- Statut : todo
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
- Implémentation : non commencée.
- Commandes exécutées / résultats : aucune.
- Preuves / fichiers : à renseigner pendant le travail.
- Blocages / décisions nouvelles : aucun identifié ; dépendances à terminer avant démarrage.
