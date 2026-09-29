# PFC-014 — Machine de jeu serveur et échéances persistées

- Statut : done
- Priorité : P0
- Lot : M2
- Dépendances : PFC-003, PFC-013

## Contexte et objectif
Faire exécuter une partie par une autorité unique malgré doublons et réveils.

## Périmètre
Ready/settings, sélection avec échéance de 5 s, résolution, alarmes et trophées persistés. Exclut UI réseau et politique complète de reconnexion.

## Règles et contraintes
SPEC + PROTOCOL ; persister avant publier ; choix cachés ; dédupe et transitions gardées ; alarme la plus proche.
Depuis PFC-008 : les échéances serveur reprennent la chronologie D09 (révélation, effet `clash` de durée
`CLASH_TIMING[kind]`, impact, résultat, pause) déjà portée par `src/client/state/game.ts` ; la partager plutôt que
la recopier, pour que le client en ligne affiche le même effet au même instant qu'en local.
Depuis PFC-013 (D37) : `Room.#dispatch` applique déjà `authorizeCommand` puis répond `INVALID_PHASE` sans effet aux
commandes de jeu autorisées (update-settings, ready, submit-choice, rematch-ready, leave) : y brancher les transitions
(commit puis `#publish`, puis ack), et le dédoublonnage par `requestId` (128 réponses par place), absent jusqu'ici.
L'alarme unique porte aussi l'échéance d'authentification des sockets : l'étendre, ne pas en créer une seconde.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| une manche attend sa révélation et l’échéance est atteinte | la même alarme est traitée deux fois | les scores et trophées ne sont appliqués qu’une fois |
| la room joue roundId=3 | un choix de roundId=2 arrive | STALE_ROUND est retourné sans changer la manche 3 |

## Critères d'acceptation
- [x] AC1 : Deux prêts démarrent ; changement de settings efface les confirmations ; seul J1 modifie ; un ready portant une ancienne settingsRevision est rejeté.
- [x] AC2 : Chaque sélection a une deadline serveur de 5 s (D08), jamais avancée par les choix ; résolution unique à échéance avec le moteur partagé, R11/R12 compris.
- [x] AC3 : Alarmes/messages répétés, requêtes obsolètes et réveil ne doublent ni points ni trophées ; une panne stockage ne publie pas de faux résultat.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Machine de jeu serveur et échéances persistées
  Scénario: PFC-014-S1 — Alarme répétée
    Étant donné une manche attend sa révélation et l’échéance est atteinte
    Quand la même alarme est traitée deux fois
    Alors les scores et trophées ne sont appliqués qu’une fois
  Scénario: PFC-014-S2 — Ancienne manche
    Étant donné la room joue roundId=3
    Quand un choix de roundId=2 arrive
    Alors STALE_ROUND est retourné sans changer la manche 3
```

## Tests et vérification
Tests runtime Workers avec temps contrôlé : double prêt, double submit, erreur stockage, hibernation/reconstruction et alarme en retard.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-014-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : terminée le 2026-09-28 (D38). Choix revus en cours de ticket :
  - **phase `starting` (choix du propriétaire)** : ouverture de 2,2 s (bannière D09) avant la manche 1, à chaque partie
    et revanche, comme la maquette en ligne ; la fenêtre de sélection reste de 5 s exactement. Contrat mis à jour
    (`PHASES`, projection, PROTOCOL) ;
  - **chronologie partagée, non recopiée** : `src/shared/cycle.ts` (déplacée de `client/state/game.ts`, réexportée,
    comportement local inchangé) ; la deadline de `round-result` couvre révélation, effet, résultat et suite
    (`roundResultMs`), donc manche suivante et écran de fin tombent au même instant qu'en local (test de parité) ;
  - **trophées à l'entrée en `match-ended`**, après le dernier résultat (rien d'annoncé pendant l'effet), gardés par
    la phase et par `settledMatchId` persisté (`settleMatch` du domaine) ;
  - **dédoublonnage** : réponses des seules commandes acceptées qui modifient la room, dans la même écriture que la
    transition (128 par place) ; un doublon reçoit le même `ack` avant toute garde ; un refus n'écrit rien ;
  - **présence** : fermer la socket d'une place retire sa confirmation (lobby, fin de partie) ; aucune partie ne
    démarre avec un absent ;
  - **alarme en retard** : une transition par échéance due, la suivante part de l'instant de traitement (D31) ;
  - **leave** : `closed` persisté avant publication, `room-closed {left}`, `ack`, fermeture 4404, stockage effacé.
- Commandes exécutées / résultats (2026-09-28) :
  - `npx tsc -b` : OK ; `npm run lint` : OK (0 avertissement) ;
  - `npx vitest run --project worker tests/integration/game.test.ts` : 16/16 ; `--project worker` répété 3 fois : 160/160 ;
  - `npm run test:functional` : 36 fichiers, 525 tests passés ;
  - `npm run test:e2e` : 143 passés, 12 ignorés (scène WebGL, Chromium seulement, existant) ;
  - `npm run verify` (build + wrangler dry-run → fonctionnel → ESLint → Playwright) : code de sortie 0 ;
  - mutations contrôlées, restaurées : échéance non vérifiée → S1 échoue ; dédoublonnage retiré → double submit
    échoue ; publication avant `commit` → test de panne échoue.
- Preuves / fichiers :
  - code : `src/shared/cycle.ts` (nouveau), `src/shared/protocol/state.ts`, `src/client/state/game.ts`,
    `src/worker/game.ts` (nouveau), `src/worker/room.ts`, `codec.ts` (schéma v3), `storage.ts` (migration v2 → v3),
    `seats.ts`, `reservations.ts` ;
  - tests : `tests/integration/game.test.ts` (nouveau : S1, S2, AC1–AC3), `storage.test.ts`, `sockets.test.ts`,
    `rooms.test.ts`, `support.ts` et harnais (panne simulée) ; `tests/unit/client/cycle-parity.test.ts` (nouveau),
    `tests/unit/protocol/{rooms.ts,policy,projection}.test.ts` ;
  - docs : PROTOCOL (transitions), DECISIONS D38, ARCHITECTURE, TESTING, TRACEABILITY.
- Blocages / décisions nouvelles : D38. Suites connues : pause pendant `starting` et reprise (PFC-017) ; inactivité
  et manches vides répétées (PFC-018) ; affichage de l'ouverture, de la chronologie et des trophées en ligne (PFC-016).
  Prochain ticket disponible : PFC-015 (lobby).
