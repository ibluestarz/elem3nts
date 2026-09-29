# PFC-002 — Moteur pur des neuf confrontations

- Statut : done
- Priorité : P0
- Lot : M1
- Dépendances : PFC-001

## Contexte et objectif
Garantir une seule interprétation des effets feu/eau/plante dans tous les modes.

## Périmètre
Types Element, score et résultat, fonction pure de résolution. Exclut UI, timers, victoire de partie et réseau.

## Règles et contraintes
SPEC R01–R06 ; les deux deltas partent du même état ; eau plancher zéro ; plante utilise les scores avant la manche.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| les scores 1/2 et les choix feu/plante | la manche est résolue | les scores deviennent 2/2 |
| les scores 0/1 et les choix eau/eau | la manche est résolue | les scores deviennent 0/0 |

## Critères d'acceptation
- [x] AC1 : Les 9 couples du mapping SPEC produisent le bon résultat.
- [x] AC2 : Plante/plante couvre retard J1, retard J2 et égalité ; eau couvre 0/0 et 0/1.
- [x] AC3 : Entrées immuables, résultats déterministes, symétrie au changement de joueurs ; aucune dépendance environnement.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Moteur pur des neuf confrontations
  Scénario: PFC-002-S1 — Feu contre plante
    Étant donné les scores 1/2 et les choix feu/plante
    Quand la manche est résolue
    Alors les scores deviennent 2/2
  Scénario: PFC-002-S2 — Plancher eau
    Étant donné les scores 0/1 et les choix eau/eau
    Quand la manche est résolue
    Alors les scores deviennent 0/0
```

## Tests et vérification
Vitest tests/unit/domain ; tables exhaustives et propriétés sur scores 0 à 12. Ajouter les 3 branches plante/plante, sans vérifier uniquement les deux exemples.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-002-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : terminée le 2026-09-27, sur `main`, sans commit (non demandé). Ticket sans UI.
- Remise en question du ticket (appliquée, tracée dans DECISIONS D25 et ARCHITECTURE « Domaine pur ») :
  - Aucun projet TypeScript ne couvrait `src/domain`. Ajout de `tsconfig.domain.json` (ES2023 sans DOM,
    `types: []`), référencé par `tsc -b`.
  - Pureté imposée par ESLint sur `src/domain/**`. Sont interdits : react, three, `node:`, `cloudflare:`,
    les autres couches, `Date`, `Math.random`, `performance`, `crypto`, `globalThis`, `console` et `process`.
    Le typecheck seul laissait passer un `import 'react'` (constaté).
  - Tests du domaine dans un projet Vitest `domain` en Node pur, sans jsdom : si le moteur dépendait du
    DOM, ces tests échoueraient.
  - Le résultat porte `kind` (vocabulaire de la maquette), `winner` et le delta **effectif** : l'UI et
    Three.js n'ont rien à recalculer (invariant « aucun score calculé par Three.js »).
  - Garde runtime : un score hors des entiers de 0 à `MAX_SCORE`, ou un élément inconnu, lève une
    `RangeError`. Le moteur ne corrompt jamais un score en silence.
  - Helper `tsc` de PFC-001 extrait dans `tests/tooling/typecheck-fixture.ts` et réutilisé.
    Le comportement de `typecheck-gate.test.ts` est inchangé.
- Commandes exécutées / résultats (Node 24.21.0) :
  - `npm run build` : `tsc -b` exit 0, projet `tsconfig.domain.json` compilé, `vite build` ✓.
  - `npm run test:functional` : 5 fichiers, 52/52 tests.
    - Projet `domain` : 41 tests. Chaque boucle exhaustive couvre 1 521 cas.
    - Projet `client` : 11 tests.
  - `npm run lint` : exit 0, 0 warning.
  - `npm run verify` : exit 0. Build ✓, 52/52 fonctionnels, lint ✓, E2E 8/8 (Chromium, Firefox, WebKit).
  - Contrôle manuel des garde-fous : `import { useState } from 'react'`, `Date.now()` et `Math.random()`
    ajoutés temporairement dans `round.ts`. `eslint src/domain` signale 3 erreurs (exit 1).
    Fichier restauré, identique par `diff`.
  - Mutations manuelles du moteur : 9 mutations appliquées, 9 tuées par `vitest run --project domain`.
    Mutations testées : plancher eau retiré, bénéficiaire de plante/plante inversé, branche égalité
    supprimée, feu/feu crédité d'un seul côté, `kind` permutés, borne `MAX_SCORE`, borne négative,
    table `BEATS` modifiée, `Object.freeze` retiré. Sources restaurées, identiques par `diff`.
- Preuves / fichiers :
  - Domaine : `src/domain/{element,round,index}.ts`, `tsconfig.domain.json`.
  - Tests :
    - `tests/unit/domain/round.test.ts` : S1, S2, AC1 à AC3, avec oracle recopié de la table SPEC ;
    - `tests/tooling/domain-purity.test.ts` et `tests/tooling/fixtures/domain-purity/` ;
    - `tests/tooling/typecheck-fixture.ts` (helper `tsc` extrait).
  - Configuration : `tsconfig.json`, `tsconfig.test.json`, `eslint.config.js`, `vitest.config.ts`.
  - Documentation : `docs/{ARCHITECTURE,DECISIONS,TESTING,TRACEABILITY}.md`, `tasks/README.md`.
- Blocages / décisions nouvelles :
  - D25 (résultat de manche) proposé par défaut, non validé par le propriétaire.
  - La maquette résout aussi `solo` (+1 au seul joueur ayant choisi à l'expiration) et `void`.
    D17 dit l'inverse pour le mode en ligne : expiration = annulation sans trophée.
    En local, il n'y a pas de délai de sélection. Ces cas ne sont pas implémentés. À trancher en
    PFC-006/014 si la maquette doit primer.
  - Gates non couverts : ceux déjà signalés en PFC-001 (Worker : PFC-011).
  - Prochains tickets prêts : PFC-003 (victoire, trophées) et PFC-004 (accueil, réglages).
