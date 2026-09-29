# PFC-024 — Règles de manche de la maquette

- Statut : done
- Priorité : P0
- Lot : M1
- Dépendances : PFC-002, PFC-003

## Contexte et objectif
Le propriétaire a décidé d'adopter les règles décrites par la maquette (D27) : le jeu réel doit correspondre aux
textes affichés (écran Règles, réglages, préparation mobile) avant que PFC-004 ne les affiche.

## Périmètre
Inclus : SPEC, DECISIONS, PROTOCOL, ARCHITECTURE, tickets `todo` impactés, moteur pur (choix manquants) et tests.
Exclus : cycle et minuterie réels (PFC-006, PFC-014), mode téléphone tour par tour (PFC-025).

## Règles et contraintes
R11 : un seul choix → +1 à ce joueur. R12 : aucun choix → manche annulée. D08 : 5 s de choix jusqu'à zéro.
D17 : même fenêtre en ligne, sans fermeture de room. D19 : local tour par tour sur téléphone.
D05 : « mort subite » = nom de la prolongation R08.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| scores 2/2, J1 choisit feu, J2 ne choisit rien | la manche est résolue | 3/2, issue `solo`, gagnant J1 |
| scores 3/1, aucun choix | la manche est résolue | 3/1, issue `void`, partie en cours |

## Critères d'acceptation
- [x] AC1 : Les 16 couples (9 confrontations + choix manquants) suivent la table SPEC sur les scores 0 à 12, avec symétrie.
- [x] AC2 : Un choix unique peut terminer une partie ; une manche vide ne change ni scores ni statut.
- [x] AC3 : SPEC, DECISIONS, PROTOCOL, ARCHITECTURE et tickets `todo` ne mentionnent plus l'ancien compte à rebours de 3 s ni la fermeture après 60 s.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Règles de manche de la maquette
  Scénario: PFC-024-S1 — Seul choix
    Étant donné scores 2/2, J1 choisit feu, J2 ne choisit rien
    Quand la manche est résolue
    Alors 3/2, issue solo, gagnant J1
  Scénario: PFC-024-S2 — Aucun choix
    Étant donné scores 3/1, aucun choix
    Quand la manche est résolue
    Alors 3/1, issue void, partie en cours
```

## Tests et vérification
`tests/unit/domain/round.test.ts` (oracle SPEC sur 2 704 cas, blocs PFC-024) et `tests/unit/domain/match.test.ts` (bloc PFC-024).

## Definition of Done
- [x] [DoD commune](../../docs/TESTING.md) satisfaite pour ce périmètre ; E2E non concernés (front inchangé).
- [x] Scénarios PFC-024-S1 et S2 traduits en tests et exécutés.
- [x] Suivi et dépendances mis à jour.

## Suivi
- Implémentation : terminée le 2026-09-28, sur `main`, sans commit. Créé et exécuté pendant PFC-004, sur arbitrage
  du propriétaire : l'écran Règles de la maquette doit décrire le jeu réel.
- Changements :
  - `Choices` accepte `null` ; nouvelles issues `solo` et `void` (D25) ;
  - un `undefined` ou un élément inconnu reste une `RangeError`.
- Commandes exécutées / résultats (Node 24.21.0) :
  - `npm run build` : exit 0.
  - `vitest run` : 113/113 tests.
  - `npm run lint` : exit 0.
  - Mutations : 5 appliquées, 5 tuées. Mutations testées :
    - gagnant `solo` inversé ;
    - `solo` J1 devenu `void` ;
    - `void` devenu `solo` ;
    - `void` crédité ;
    - `null` refusé.
- Preuves / fichiers :
  - Code : `src/domain/{round,index}.ts`.
  - Tests : `tests/unit/domain/{round,match}.test.ts`.
  - Documentation : `docs/{SPEC,DECISIONS,PROTOCOL,ARCHITECTURE,TRACEABILITY}.md`.
  - Tickets réalignés : PFC-006 (renommé « Cycle local et fenêtre de choix »), 010, 014, 016, 017, 018 et 019.
  - Ticket créé : PFC-025.
- Blocages / décisions nouvelles :
  - D27 est une exigence du propriétaire ; D05, D08, D17, D19 et D25 ont été mis à jour en conséquence.
  - La maquette annule aussi la manche lors d'une coupure réseau (notes de conception).
    Ce n'est pas adopté : D15 (pause puis reprise) reste en vigueur, car ce point n'a pas été arbitré.
