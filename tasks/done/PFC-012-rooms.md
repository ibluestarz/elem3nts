# PFC-012 — Création et réservation des rooms privées

- Statut : done
- Priorité : P1
- Lot : M2
- Dépendances : PFC-011

## Contexte et objectif
Inviter exactement un adversaire avec un code non prédictible.

## Périmètre
Create/join HTTP, génération code, places, tokens, collision, erreurs et réservations 30 s. Exclut gameplay.

## Règles et contraintes
PROTOCOL entrée ; deux places atomiques, tokens 256 bits, codes 8 caractères ; join ne crée jamais une room absente.
Stockage (PFC-011, D35) : ajouter hashes et réservations à `PersistedRoom` incrémente `ROOM_SCHEMA_VERSION` avec migration testée ; écrire par `Room.commit` (révision croissante) ; erreurs HTTP au format de PROTOCOL « Erreurs HTTP ».
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| une room active contient seulement J1 | un invité rejoint avec son code | J2 est réservé et un token privé distinct lui est remis |
| J2 est libre | deux invités rejoignent simultanément | un seul obtient J2 et l’autre reçoit ROOM_FULL |

## Critères d'acceptation
- [x] AC1 : Créer réserve J1 et fournit code/token ; rejoindre réserve J2 avec token distinct.
- [x] AC2 : Arrivées simultanées n’accordent jamais deux fois J2 ; troisième, room expirée et code invalide refusés.
- [x] AC3 : Collision de code réessayée sans écrasement ; token hash seul persisté ; réservation abandonnée nettoyée.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Création et réservation des rooms privées
  Scénario: PFC-012-S1 — Invitation
    Étant donné une room active contient seulement J1
    Quand un invité rejoint avec son code
    Alors J2 est réservé et un token privé distinct lui est remis
  Scénario: PFC-012-S2 — Course de join
    Étant donné J2 est libre
    Quand deux invités rejoignent simultanément
    Alors un seul obtient J2 et l’autre reçoit ROOM_FULL
```

## Tests et vérification
Intégration DO : concurrence, codes normalisés, collision forcée, expiration réservation, absence de token dans logs/état public.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-012-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : terminée le 2026-09-28 (D36). Choix revus en cours de ticket :
  - le Durable Object ne reçoit que le SHA-256 du token ; il décide et `commit` sans `await` intermédiaire,
    donc une place n'est jamais accordée deux fois, par construction et non par chance de timing ;
  - `RoomStore` créait sa table dans le constructeur : un join sur un code inconnu allouait déjà du stockage.
    Création désormais paresseuse, et une room fermée est entièrement effacée (`deleteAll`, alarme annulée) ;
  - `createdAt` persisté dès la création (durée maximale D16, PFC-018) pour éviter une migration à valeur inventée ;
  - absent, expiré, fermé et mal formé renvoient la même réponse `404 ROOM_UNAVAILABLE` (pas d'oracle d'énumération) ; illisible `503` ;
    collisions épuisées `503 CODE_COLLISION` + `Retry-After` ; méthode autre que POST `405` + `Allow` ;
  - `RATE_LIMITED` n'est pas livré ici : PROTOCOL l'attribuait à tort à PFC-012 alors qu'il exige un mécanisme
    partagé relevant de PFC-020 (ticket annoté, PROTOCOL corrigé) ;
  - aucune UI : l'interface créer/rejoindre relève de PFC-015 ; aucune maquette n'est concernée.
- Commandes exécutées / résultats (Node via `nvm use`) :
  - `npx vitest run --project worker` avant travaux : 35 tests passés (référence) ;
  - `npm run verify` : sortie 0. `tsc -b`, `vite build`, `wrangler deploy --dry-run` OK ; Vitest 32 fichiers,
    446 tests passés ; ESLint 0 avertissement ; Playwright 137 passés, 12 ignorés (cas `scene.spec.ts` réservés
    à Chromium, ignorés sous Firefox/WebKit avant ce ticket) ;
  - après un ajout d'assertion en cours de gate : `tsc -b`, `vitest run` (446 passés) et `eslint` relancés sur l'arbre final, OK ;
  - mutations contrôlées (restaurées) : minuterie de 1 ms avant `commit` dans `join` → la rafale interne de 30 joins
    échoue (plusieurs J2) ; 12 requêtes HTTP concurrentes ne détectent qu'une fenêtre de 20 ms (12 J2 accordés), d'où
    la rafale. Un `crypto.subtle.digest` à la même place n'ouvre aucune fenêtre dans workerd.
- Preuves / fichiers :
  - code : `src/worker/{entry,tokens,reservations}.ts` (nouveaux), `room.ts`, `codec.ts` (schéma v2, invariants),
    `storage.ts` (migration v1→v2, table paresseuse), `http.ts`, `index.ts` ; `src/shared/protocol/entry.ts` (`parseRoomEntry`) ;
  - tests : `tests/integration/rooms.test.ts` (S1, S2 HTTP et rafale, AC1–AC3, échéances aux bornes, alarme réelle,
    absence de token dans stockage, projection, erreurs et journaux), `tokens.test.ts`, `storage.test.ts` (migration,
    invariants des places), `tests/unit/protocol/entry.test.ts`, `tests/e2e/worker.spec.ts` (3 contextes, build réel) ;
    harnais : horloge figée, alarme, codes imposés, rafale (`tests/integration/harness/entry.ts`) ;
  - docs : PROTOCOL « Entrée HTTP », ARCHITECTURE « Rooms privées », DECISIONS D36, TESTING « Depuis PFC-012 » ;
    notes de passation dans PFC-013, PFC-018 et PFC-020.
- Blocages / limites : aucun blocage. Tant que PFC-013 n'existe pas, aucune place ne peut se connecter : toute room
  est fermée 30 s après sa création (comportement prévu par PROTOCOL). Pas de journalisation côté Worker (ESLint
  `no-console`, logger structuré en PFC-020) : le test « journaux » prouve l'absence de token dans les logs capturés
  par le runtime. Aucune limite de débit ni contrôle `Origin` sur create/join avant PFC-020.
- Prochain ticket disponible : PFC-013 (WebSocket authentifié) ; PFC-025 et PFC-026 (M1) sont aussi prêts.
