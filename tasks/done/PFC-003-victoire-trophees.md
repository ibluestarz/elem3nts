# PFC-003 — Victoire nul prolongation et trophées idempotents

- Statut : done
- Priorité : P0
- Lot : M1
- Dépendances : PFC-002

## Contexte et objectif
Terminer les parties correctement même quand les deux joueurs atteignent le seuil ensemble.

## Périmètre
Résultat de partie, compteur de trophées de session, garde par matchId. Exclut écrans et persistance serveur.

## Règles et contraintes
SPEC R07–R10 ; nul OFF exige >= X et avance stricte ; attribution une seule fois, après calcul simultané.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| X vaut 3, nul ON et les scores 2/2 | feu/feu est résolu | les scores sont 3/3, la partie est nulle et chacun reçoit un trophée |
| X vaut 3, nul OFF et les scores 3/3 | feu/plante est résolu | J1 gagne à 4/3 et reçoit un seul trophée |

## Critères d'acceptation
- [x] AC1 : X=1 et X=10 couverts avec nul ON/OFF et scores supérieurs à X.
- [x] AC2 : La prolongation peut redescendre sous X ; aucun plafond ou départage inventé.
- [x] AC3 : Un résultat répété du même matchId ne change plus les trophées ; une annulation ne récompense personne.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Victoire nul prolongation et trophées idempotents
  Scénario: PFC-003-S1 — Nul simultané
    Étant donné X vaut 3, nul ON et les scores 2/2
    Quand feu/feu est résolu
    Alors les scores sont 3/3, la partie est nulle et chacun reçoit un trophée
  Scénario: PFC-003-S2 — Prolongation
    Étant donné X vaut 3, nul OFF et les scores 3/3
    Quand feu/plante est résolu
    Alors J1 gagne à 4/3 et reçoit un seul trophée
```

## Tests et vérification
Vitest : double dispatch de fin, replay de résultat, baisse 3/3 vers 2/2 et nouvelle victoire ; tests de session sur plusieurs matchId.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-003-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : terminée le 2026-09-27, sur `main`, sans commit (non demandé). Ticket sans UI.
- Remise en question du ticket (appliquée, tracée dans DECISIONS D26 et ARCHITECTURE « Domaine pur ») :
  - Transition atomique `playRound` : la manche est résolue, puis seulement la fin est évaluée (R06).
    Aucun appelant ne peut évaluer la fin sur un état intermédiaire.
  - Annulation modélisée (`cancelMatch`, statut `cancelled`). Elle est réglée sans trophée et verrouille
    son matchId : un résultat du même matchId arrivé ensuite n'est pas récompensé.
  - La session garde **tous** les matchId réglés : un replay ancien, reçu après une partie plus récente,
    est aussi ignoré. Garder seulement le dernier matchId l'aurait laissé passer.
  - Doublon = no-op observable (`applied: false`, même objet session) conforme à R10. Transitions
    interdites : `DomainError` `MATCH_OVER` (manche après la fin) et `MATCH_NOT_OVER` (trophée en cours),
    sans mutation.
  - Aucune API d'injection de scores (TESTING) : les tests atteignent 2/2, 3/3 ou 9/9 en jouant de vraies manches.
  - Garde runtime `assertSettings` (X entier 1–10, nul booléen), réutilisable par PFC-004.
    `assertScores` est extrait de `round.ts`, avec un comportement PFC-002 inchangé (41 tests verts).
- Commandes exécutées / résultats (Node 24.21.0) :
  - `npx tsc -b` : exit 0. `npm run lint` : exit 0, 0 warning.
  - `npm run test:functional` : 7 fichiers, 104/104 tests.
    - Projet `domain` : 93 tests, dont 52 nouveaux pour PFC-003.
    - Projet `client` : 11 tests.
  - `npm run verify` : exit 0. Build ✓, 104/104 fonctionnels, lint ✓, E2E 8/8 (Chromium, Firefox, WebKit).
  - Mutations manuelles : 14 mutations appliquées, 14 tuées par `vitest run --project domain`.
    Mutations testées :
    - seuil `>=` → `>` ;
    - avance stricte OFF → `>=` ;
    - avance stricte OFF supprimée pour J2 ;
    - branche nul ON supprimée ;
    - garde de fin supprimée ;
    - annulation d'une partie terminée ;
    - évaluation sur les scores avant manche ;
    - borne X=11 ;
    - réglages non copiés ;
    - garde de doublon supprimée ;
    - trophée du nul faux ;
    - annulation récompensée ;
    - registre réduit au dernier matchId ;
    - partie en cours récompensée.
    Sources restaurées, identiques par `diff`.
- Preuves / fichiers :
  - Domaine : `src/domain/{errors,match,session}.ts` (créés), `src/domain/{round,index}.ts` (modifiés).
  - Tests : `tests/unit/domain/match.test.ts`, `tests/unit/domain/session.test.ts`.
    - `match.test.ts` : S1, S2, les 11 exemples chiffrés de la SPEC, AC1 avec oracle R07/R08 de 2 600 cas
      (X 1–10, nul ON/OFF, scores 0–12) et symétrie, AC2, double dispatch, entrées invalides.
    - `session.test.ts` : trophées S1/S2, replays, annulation, plusieurs matchId.
  - Documentation : `docs/{ARCHITECTURE,DECISIONS,TRACEABILITY}.md`, `tasks/README.md`.
- Blocages / décisions nouvelles :
  - D26 proposé par défaut, non validé par le propriétaire.
  - Hors périmètre, pour les tickets suivants :
    - roundId, phases (`selecting`/`countdown`…) et échéances : PFC-006 et PFC-014 ;
    - persistance du registre `settledMatchIds` côté serveur : PFC-014 ;
    - messages lisibles de saisie des réglages : PFC-004, à bâtir sur `assertSettings`.
  - Gates non couverts : ceux déjà signalés en PFC-001 (Worker : PFC-011).
  - Prochain ticket prêt : PFC-004 (accueil et réglages). PFC-005 dépend de PFC-004 ; PFC-010 est prêt
    côté dépendances (PFC-002, PFC-003).
