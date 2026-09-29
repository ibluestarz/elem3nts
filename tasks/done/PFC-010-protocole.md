# PFC-010 — Schémas et projection publique du protocole v1

- Statut : done
- Priorité : P0
- Lot : M2
- Dépendances : PFC-002, PFC-003

## Contexte et objectif
Définir une frontière réseau vérifiable avant de créer les rooms.

## Périmètre
Types de messages, validation runtime, codes d’erreur, projection publique et compatibilité v1. Exclut transport réel.

## Règles et contraintes
PROTOCOL est normatif ; unknown à l’entrée, unions discriminées après parsing ; allowlist de sortie.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| la room stocke feu/plante en phase selecting | un snapshot public est construit | aucun des deux éléments ni token/hash n’apparaît |
| un message submit-choice contient element=stone | le schéma valide le message | une erreur INVALID_MESSAGE est retournée sans modifier l’état |

## Critères d'acceptation
- [x] AC1 : Tous les messages et phases autorisés/refusés du protocole sont couverts.
- [x] AC2 : L’état avant révélation ne contient jamais choix privés ni token/hash ; erreurs et ack non plus.
- [x] AC3 : Mauvais type, taille, version, élément, identifiants ou champs inconnus sont refusés sans mutation.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Schémas et projection publique du protocole v1
  Scénario: PFC-010-S1 — Projection secrète
    Étant donné la room stocke feu/plante en phase selecting
    Quand un snapshot public est construit
    Alors aucun des deux éléments ni token/hash n’apparaît
  Scénario: PFC-010-S2 — Entrée invalide
    Étant donné un message submit-choice contient element=stone
    Quand le schéma valide le message
    Alors une erreur INVALID_MESSAGE est retournée sans modifier l’état
```

## Tests et vérification
Vitest tests/unit/protocol : projections toutes phases y compris pause/reconnexion, messages malformés et bornes.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-010-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation (2026-09-28) : contrat v1 pur dans `src/shared/protocol/` (`limits`, `errors`, `schema`,
  `commands`, `policy`, `state`, `server`, `index`), sans dépendance ajoutée.
  - `parseClientMessage` : entrée `unknown`, ne lève jamais, commande neuve gelée ou refus `{code, reason, requestId?}`.
  - `authorizeCommand` : politique pure commande × phase × place (codes de PROTOCOL).
  - `projectState` : allowlist champ par champ ; constructeurs ack/error/pong/room-closed.
  - `parseServerMessage` : validation stricte côté client.
  - Outillage : projet `tsconfig.shared.json` (ES2023 sans DOM, `types: []`), règles de pureté ESLint
    `src/shared/**`, projet Vitest `protocol` (Node).
- Remises en question du ticket et de PROTOCOL (D34, PROTOCOL « Schémas v1 ») :
  - le contrat va dans `src/shared/` comme le prévoit ARCHITECTURE ;
  - payloads exacts, dont `payload: {}` pour leave/ping ;
  - `rematch-ready` porte le `matchId` de la partie terminée : sans lui, une confirmation retardée pouvait
    valoir pour la revanche suivante ;
  - `state` ajoute `connected` (lobby, pause : PFC-015/017), `resumePhase` et `matchResult` ;
  - formats fixés : token 32 octets base64url, identifiants bornés, taille mesurée en octets UTF-8 ;
  - ordre des gardes documenté ; messages d'erreur fixes, sans réflexion d'entrée ;
  - motif `reason` gardé côté serveur pour la règle des 3 dépassements (PFC-013) ;
  - une manche révélée n'est publiée que si c'est la manche courante et que la phase est révélée
    (double barrière).
- Commandes exécutées / résultats :
  - `npx vitest run --project protocol` : 48/48 ;
  - `npm run test:functional` : 337/337 (projets domain, protocol, client), EXIT 0 ;
  - `npm run lint` : EXIT 0 ;
  - `npx tsc -b` (typecheck de tous les projets, sans émission) : EXIT 0.
- Preuves complémentaires :
  - sonde temporaire (supprimée) dans `src/shared` : ESLint refuse react, `client/`, `Date`, `Math.random` ;
    tsc refuse `document` ;
  - 9 mutations contrôlées, puis restaurées (`cmp` identique), chacune détectée par au moins un test :
    - verrous qui exposent la sélection : 7 échecs ;
    - révélation en sélection et en pause : 2 ;
    - `lastRound` d'une autre manche : 1 ;
    - stockage recopié : 10 ;
    - champ de payload inconnu admis : 2 ;
    - limite de taille retirée : 1 ;
    - CHOICE_LOCKED retiré : 1 ;
    - NOT_HOST retiré : 1.
- Preuves / fichiers : `tests/unit/protocol/{rooms.ts,projection,commands,policy,server}.test.ts`,
  `docs/PROTOCOL.md`, `docs/DECISIONS.md` (D34), `docs/ARCHITECTURE.md`, `docs/TESTING.md`,
  `docs/TRACEABILITY.md`, `tsconfig.json`, `tsconfig.shared.json`, `tsconfig.test.json`,
  `eslint.config.js`, `vitest.config.ts`.
- Gate complet (2026-09-28, autorisé par le propriétaire après un premier refus de permission) :
  `npm run verify` EXIT 0.
  - build `tsc -b` puis `vite build` : OK ;
  - fonctionnel : 337/337, 26 fichiers ;
  - ESLint : 0 avertissement ;
  - Playwright : 122 réussis, 12 ignorés (specs scène et parité visuelle réservées à Chromium, sous
    Firefox et WebKit).
- Blocages : aucun.
- Prochain ticket : PFC-011 (dépend de PFC-001 et PFC-010, tous deux done).
