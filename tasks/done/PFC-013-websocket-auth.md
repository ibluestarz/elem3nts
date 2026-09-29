# PFC-013 — WebSocket authentifié et isolation des joueurs

- Statut : done
- Priorité : P0
- Lot : M2
- Dépendances : PFC-012

## Contexte et objectif
Autoriser chaque joueur à agir seulement pour sa propre place.

## Périmètre
Upgrade, auth initiale 5 s, Origin, socket generation, ack/errors, limites de message. Exclut résolution de jeu.

## Règles et contraintes
PROTOCOL transport ; WSS prod ; token dans premier message, jamais URL ; ancienne socket invalidée.
Depuis PFC-012 (D36) : la room ne connaît que `seats[slot].tokenHash` (SHA-256 hex, `hashResumeToken`) ; comparer à temps
constant, puis dans la même transition `reservedUntil = null` et `connected[slot] = true` (invariant du codec). Une
place dont la réservation est échue est déjà libérée/fermée par `settleReservations` : l'auth doit la traiter avant.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| J2 dispose de son resumeToken | il authentifie une socket dans les 5 secondes | il reçoit un état projeté pour J2 |
| une socket appartient à J2 | elle tente une commande réservée à J1 | NOT_HOST est retourné sans modification |

## Critères d'acceptation
- [x] AC1 : Sans auth dans 5 s, socket fermée sans snapshot ; token invalide rejeté.
- [x] AC2 : Une socket authentifiée est associée à sa place ; le client ne peut usurper J1/J2.
- [x] AC3 : Deux rooms isolées ; nouvelle socket de même place remplace l’ancienne ; Origin refusée sans données.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: WebSocket authentifié et isolation des joueurs
  Scénario: PFC-013-S1 — Authentification
    Étant donné J2 dispose de son resumeToken
    Quand il authentifie une socket dans les 5 secondes
    Alors il reçoit un état projeté pour J2
  Scénario: PFC-013-S2 — Usurpation
    Étant donné une socket appartient à J2
    Quand elle tente une commande réservée à J1
    Alors NOT_HOST est retourné sans modification
```

## Tests et vérification
Tests d’intégration WebSocket réels : timeout, Origin, token, ancienne génération, isolation et payload trop grand.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-013-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : terminée le 2026-09-28 (D37). Choix revus en cours de ticket :
  - **sockets standard, pas d'hibernation** : reproduit sur le workerd local, une socket hibernable fermée depuis
    l'alarme ou le `fetch` termine la poignée de fermeture mais garde le TCP ouvert (le client ne voit jamais la
    fermeture) ; or le timeout de 5 s et les futures fermetures de room partent d'une alarme. Sockets standard :
    fermeture en 3 ms. Identité de connexion en mémoire (`pending → player → retired`), file de trames par socket ;
  - **échéance de 5 s portée par l'alarme unique** (plus proche avec les réservations), revérifiée à chaque trame ;
    une trame à l'instant exact est trop tardive ; aucun minuteur perdu à la reconstruction ;
  - **Origin** : allowlist d'une entrée, l'origine exacte de la requête (même origine en dev, preview, prod) ; absente
    ou `null` refusée ; 403 JSON avant toute room. Une liste configurable était un piège sans bénéfice ;
  - **place dérivée du token seul** (SHA-256 comparé à temps constant aux deux places, sans court-circuit) ; le client
    ne peut pas la désigner (clé inconnue refusée par le schéma) ;
  - **room absente** : upgrade accepté puis `ROOM_UNAVAILABLE` + 4404, pour que la reconnexion (PFC-017) distingue
    « room disparue » de « réseau coupé » ; codes de fermeture partagés 4401/4404/4408/4409/4429 ;
  - limites **par connexion** livrées ici (4 KiB, 20/s rafale 30, 4429 au 3e dépassement) : une boucle de socket ne
    doit pas exister sans borne ; limites partagées et nombre de sockets par room restent à PFC-020 ;
  - fermeture de la socket courante : présence persistée à faux et publiée ; libération d'une réservation échue
    désormais publiée aux présents ; commandes de jeu autorisées : `INVALID_PHASE` sans effet jusqu'à PFC-014 ;
  - aucune UI : l'interface en ligne relève de PFC-015 ; aucune maquette concernée.
- Commandes exécutées / résultats (Node via `nvm use`, 2026-09-28) :
  - `npx vitest run --project worker` avant travaux : 97 tests passés (référence) ;
  - `npx vitest run --project worker` : 132 passés (35 nouveaux) ; `sockets.test.ts` relancé 3 fois : 35/35 à chaque fois ;
  - `npx playwright test tests/e2e/worker.spec.ts` : 21 passés (Chromium, Firefox, WebKit) ;
  - `npm run dev` (port 5173) : socket authentifiée depuis Node, `state` puis `ack` ; Origin tierce refusée ;
  - `npm run verify` : sortie 0. `tsc -b`, `vite build`, `wrangler deploy --dry-run` OK ; Vitest 34 fichiers,
    484 tests passés ; ESLint 0 avertissement ; Playwright 143 passés, 12 ignorés (cas `scene.spec.ts` réservés à
    Chromium, déjà ignorés avant ce ticket) ;
  - mutations contrôlées (restaurées, fichiers identiques octet pour octet) : Origin non vérifiée → 5 échecs ;
    ancienne socket non retirée → 1 ; réservation conservée à l'authentification → 16 ; échéance `>` au lieu de
    `>=` → 1 ; trame invalide avant authentification sans fermeture → 5.
- Preuves / fichiers :
  - code : `src/worker/{seats,sockets}.ts` (nouveaux), `room.ts` (sockets, alarme, publication), `entry.ts`
    (`connectRoom`, Origin), `index.ts` (route `/ws`), `http.ts` (403, 426, 405 `Allow: GET`) ;
    `src/shared/protocol/socket.ts` (constantes, codes de fermeture, `roomSocketPath`) ;
  - tests : `tests/integration/sockets.test.ts` (S1, S2, AC1–AC3 sur vraies sockets réseau), `support.ts`
    (sonde WebSocket avec Origin), `storage.test.ts` (titre mis à jour), `tests/unit/protocol/socket.test.ts`,
    `tests/e2e/worker.spec.ts` (S1 et remplacement par un second onglet, 3 navigateurs) ;
  - docs : PROTOCOL « WebSocket (PFC-013, D37) » et erreurs HTTP, DECISIONS D37, ARCHITECTURE « WebSocket
    authentifié », TESTING (dev, projet worker), TRACEABILITY (lignes PFC-012, absente, et PFC-013) ;
    notes de passation dans PFC-014, PFC-015, PFC-017 et PFC-020.
- Blocages / décisions nouvelles : aucun blocage. Limites connues, assignées : dédoublonnage `requestId` (PFC-014) ;
  pause, délai D15 et présence restée vraie après perte d'instance (PFC-017) ; limite partagée des upgrades et
  sockets par room (PFC-020) ; comportement de fermeture des sockets hibernables en production non mesuré (D37).
