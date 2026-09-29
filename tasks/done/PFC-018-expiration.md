# PFC-018 — Expiration nettoyage et limites de session

- Statut : done
- Priorité : P1
- Lot : M2
- Dépendances : PFC-017

## Contexte et objectif
Éviter les rooms et connexions abandonnées qui restent actives indéfiniment.

## Périmètre
TTL inactivité 30 min (manches vides non comptées comme activité, D17), maximum 4 h, leave, suppression état et sockets. Exclut historique permanent.

## Règles et contraintes
D16/D17 + PROTOCOL ; ping ne prolonge pas la room ; pas de récompense pour expiration ; minimum des échéances dans l’alarme.
Depuis PFC-012 (D36) : libération de J2 jamais connecté et fermeture/effacement si J1 ne se connecte pas déjà livrées
(`reservations.ts`, alarme unique) ; `createdAt` persisté (v1 migrée : `0`, donc fermée par la durée maximale).
Intégrer ces échéances au minimum calculé par l'alarme plutôt que d'en planifier une seconde.
Depuis PFC-017 (D42) : `nextGameDeadline` couvre déjà le délai de reconnexion ; `#settle` réconcilie la présence à chaque
événement. Une instance perdue au lobby ou en fin de partie, sans client de retour, n'a aucune alarme : les échéances
d'inactivité et de durée maximale de ce ticket la réveilleront (réconciliation puis fermeture à 30 s). La durée
maximale reste absolue pendant une pause.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| aucune manche en ligne n’a reçu de choix depuis 30 minutes | l’échéance d’inactivité est traitée | la room est fermée sans trophée et les deux clients en sont informés |
| une room est inactive depuis presque 30 minutes | des ping sont envoyés jusqu’à l’échéance | la room expire malgré ces ping |

## Critères d'acceptation
- [x] AC1 : Inactivité (manches vides comprises) et durée maximale ferment correctement avec raison lisible ; une manche vide seule ne ferme pas la room (R12).
- [x] AC2 : Les tokens, choix et sockets sont supprimés/fermés ; aucun join ne recrée une room expirée.
- [x] AC3 : Une réservation J2 jamais connectée se libère avant partie ; quitter une room la ferme pour les deux.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Expiration nettoyage et limites de session
  Scénario: PFC-018-S1 — Absence de choix prolongée
    Étant donné aucune manche en ligne n’a reçu de choix depuis 30 minutes
    Quand l’échéance d’inactivité est traitée
    Alors la room est fermée sans trophée et les deux clients en sont informés
  Scénario: PFC-018-S2 — Ping sans activité
    Étant donné une room est inactive depuis presque 30 minutes
    Quand des ping sont envoyés jusqu’à l’échéance
    Alors la room expire malgré ces ping
```

## Tests et vérification
Tests Worker avec temps contrôlé et alarmes concurrentes ; vérifier suppression sensible et limite absolue pendant pause.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-018-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : terminée (2026-09-29), décision [D43](../../docs/DECISIONS.md).
  - Lecture senior du ticket, écarts assumés : (1) l'activité utile ne se limite pas aux choix : création, **première**
    connexion d'une place et toute commande acceptée qui modifie la room comptent ; sans la première connexion, un invité
    arrivé à 29 min au lobby voyait la room fermer aussitôt. Reprise de place, réservation HTTP seule (tout porteur du
    code), ping, refus et commande sans effet ne comptent pas. (2) Motif = échéance survenue la première, pas un ordre
    fixe : une alarme en retard dit la vraie cause. (3) Fin de vie avant échéance de jeu au même instant : aucune
    récompense par expiration. (4) Les fermetures par expiration sont annoncées par une notification **persistante** :
    une notification de 4 s est invisible pour qui revient d'une absence de 30 min.
  - Serveur : `src/worker/expiry.ts` (pur : `dueClosure`, `nextClosureDeadline`, `recordActivity`) ; `#settle` =
    réservations → fin de vie → jeu → présence ; alarme unique = min(réservation, fin de vie, jeu, authentification),
    donc toute room ouverte en a une (lève la limite de PFC-017 : instance perdue au lobby/fin de partie). Fermeture
    identique à D42 (`closed` persisté, `room-closed {reason}`, 4404, stockage effacé). Schéma v5 (`lastActivityAt`,
    ≥ `createdAt`), migration v4 → v5 (`lastActivityAt = createdAt`). Constantes partagées `ROOM_IDLE_TIMEOUT_MS`,
    `ROOM_MAX_DURATION_MS`. `leave` et libération de J2 jamais connecté : déjà livrés (PFC-012/014), prouvés ci-dessous.
  - Client : textes dérivés des constantes (« … aucun trophée attribué »), `isLastingEnd`, `ToastOptions.persistent`
    (fermeture au bouton, WCAG 2.2.1) pour `inactive`, `max-duration` et « fermée pendant la coupure ».
- Commandes exécutées / résultats (Node 24.21.0 via `nvm use`) :
  - `npm run verify` final : build (`tsc -b`, `vite build`, `wrangler deploy --dry-run`) OK ; `vitest run` 46 fichiers,
    701 tests OK ; `eslint . --max-warnings=0` OK ; Playwright 206 réussis, 12 ignorés par conception (comparaisons WebGL
    réservées à Chromium, préexistants), code de sortie 0.
  - Intermédiaires : `vitest --project worker` : 7 échecs attendus après le passage en v5 (tests qui supposaient
    « aucune alarme » au lobby/fin de partie, v1 migrée désormais fermée par la durée maximale, champs de migration),
    réécrits au contrat D43 ; 3 échecs de mise en place du nouveau fichier (seuil de manches, activité manquante dans
    le scénario 4 h — le serveur fermait à juste titre pour inactivité —, éviction impossible avec sockets ouvertes).
    `playwright test tests/e2e/expiry.spec.ts` : 6/6 (3 navigateurs).
  - Mutations contrôlées (restaurées, fichiers identiques) : motif à ordre fixe → « motif de la première survenue »
    échoue ; reprise de place comptée comme activité → « activité utile… » échoue.
  - Captures manuelles (Chromium, bureau et téléphone) de la notification persistante sur le menu en ligne : conforme à
    la DA des notifications existantes ; aucun écran de la maquette modifié (parité visuelle inchangée, verte).
- Preuves / fichiers :
  - Tests : `tests/integration/expiry.test.ts` (14 : S1 plus de 150 manches vides → `inactive` aux deux ; manche vide
    seule (R12) ; S2 pings puis ping à l'instant exact ; activité ou non ; invité tardif ; 4 h avec activité ; 4 h en
    pause avant la reconnexion ; première échéance ×2 ; alarmes concurrentes ×3 ; alarme + commandes simultanées ;
    socket non authentifiée ; instance perdue), `tests/integration/storage.test.ts` (v5, migration v4 → v5, invariants),
    `tests/unit/client/OnlineExpiry.test.tsx` (4), `tests/e2e/expiry.spec.ts` (2 × 3 navigateurs). AC3 : `rooms.test.ts`
    « J2 jamais connecté avant la partie : seul J2 est libéré », `game.test.ts` « leave en pleine manche : room fermée
    pour les deux », `lobby.spec.ts` « J1 quitte le lobby ». Tests PFC-012/013/014/017 adaptés à l'alarme permanente.
  - Code : `src/worker/{expiry,room,game,seats,reservations,codec,storage}.ts`, `src/shared/protocol/{socket,index}.ts`,
    `src/client/online/{messages,useOnlineRoom}.ts`, `src/client/components/{Toast.tsx,toastContext.ts}`,
    `tests/integration/support.ts` (`persisted(room, createdAt)`), `tests/e2e/online-fake.ts` (`close`).
  - Docs : DECISIONS (D43), PROTOCOL (« Inactivité et durée maximale », activité utile), ARCHITECTURE, SPEC, TESTING,
    TRACEABILITY, PFC-019 (note de reprise).
- Blocages / décisions nouvelles : aucun blocage. Décision : D43 (choix par défaut proposé, non validé par le
  propriétaire). Limites : aucun avertissement avant l'expiration (exigerait une échéance publiée dans `state` : ticket
  à créer si souhaité) ; expiration réelle de 30 min / 4 h non attendue en E2E (aucune horloge de test dans le Worker de
  production), prouvée dans le runtime Workers à horloge figée ; une instance perdue sans client est effacée au plus
  tard à son échéance d'inactivité (≤ 30 min). Prochain ticket disponible : PFC-019.
- Correctif de test (2026-09-29, session PFC-016, avant le commit groupé) : PFC-018-S1 dépassait le délai de 30 s
  (~42 s mesurés, 150+ manches) et, non interrompu, faisait échouer le test suivant par l'horloge figée partagée ;
  délai explicite de 120 s sur ce seul test. Aucun changement de code.
