# PFC-019 — Recette multijoueur et tests adverses

- Statut : done
- Priorité : P0
- Lot : M2
- Dépendances : PFC-018

## Contexte et objectif
Prouver que le jeu résiste aux entrées invalides et aux courses réseau.

## Périmètre
Suite intégration/E2E multijoueur, isolation, doublons, restauration et fuites. Exclut tests de charge massifs.

## Règles et contraintes
TESTING ; deux contextes vrais, troisième pour room pleine ; aucune route de triche dans le bundle production.
Depuis PFC-018 (D43) : toute room ouverte porte une alarme (au plus tard son inactivité, 30 min) ; une alarme
répétée ou concurrente à l'échéance est déjà couverte pour la fin de vie (`tests/integration/expiry.test.ts`). Les
fixtures relues par une vraie room doivent être datées près de l'horloge du test (`persisted(room, createdAt)`),
sinon la durée maximale de 4 h les ferme au premier traitement.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| deux rooms indépendantes jouent en parallèle | une manche est gagnée dans la première | aucun état ni trophée de la seconde ne change |
| deux choix sont verrouillés avant l’échéance de sélection | les trames reçues du serveur par les deux clients sont inspectées | aucun élément choisi n’est présent avant l’événement de révélation |

## Critères d'acceptation
- [x] AC1 : Parcours deux joueurs jusqu’à trophée et revanche passe dans les trois moteurs Playwright.
- [x] AC2 : Doublons, obsolètes, mauvaise phase, room tierce, reconnect et alarme répétée couverts.
- [x] AC3 : Captures serveur → clients prouvent absence de choix avant reveal et de tokens dans états/logs ; tests déterministes.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Recette multijoueur et tests adverses
  Scénario: PFC-019-S1 — Deux rooms
    Étant donné deux rooms indépendantes jouent en parallèle
    Quand une manche est gagnée dans la première
    Alors aucun état ni trophée de la seconde ne change
  Scénario: PFC-019-S2 — Fuite avant révélation
    Étant donné deux choix sont verrouillés avant l’échéance de sélection
    Quand les trames reçues du serveur par les deux clients sont inspectées
    Alors aucun élément choisi n’est présent avant l’événement de révélation
```

## Tests et vérification
npm run verify ; intégrer les tests de panne/reconstruction au runtime Worker, pas seulement à des mocks ; traces expurgées.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-019-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : terminée (2026-09-29), décision [D44](../../docs/DECISIONS.md). Ticket de tests : aucun code applicatif
  modifié, aucun écran touché (parité maquette inchangée, verte).
  - Lecture senior du ticket, écarts assumés : (1) S1 prouvé en intégration (horloge figée partagée, B décalée de 7,1 s
    pour qu'aucune de ses échéances ne soit due aux points de contrôle) : déterministe, alors qu'un E2E à quatre
    contextes sur l'horloge réelle n'ajouterait aucune garantie ; (2) AC1 en un seul parcours E2E (trophée, troisième
    contexte refusé **en pleine partie**, revanche **jouée** jusqu'au second trophée) au lieu des deux tests partiels
    de PFC-016 ; (3) tokens vérifiés sur toutes les trames reçues d'une partie complète, pas seulement au lobby ;
    (4) journaux vérifiés sur tout le cycle de vie, pas seulement création/jonction ; (5) « aucune route de triche »
    rendu vérifiable (inspection de `dist/` et sondes) ; (6) course réseau ajoutée : commande renvoyée après reprise sur
    une nouvelle socket ; (7) TRACEABILITY attribuait à PFC-019 « nul simultané : trophée chacun » sans preuve en ligne :
    test ajouté.
  - Constat : le `matchId` n'est unique que dans sa room (`m-<révision>`) ; sans risque, les commandes étant rattachées à
    la room de la socket authentifiée (D44).
- Commandes exécutées / résultats (Node via `nvm use`) :
  - `npm run verify` final, code de sortie 0 : build (`tsc -b`, `vite build`, `wrangler deploy --dry-run`) OK ;
    `vitest run` 47 fichiers, 723 tests OK (701 + 22) ; `eslint . --max-warnings=0` OK ; Playwright 215 réussis
    (206 + 9), 12 ignorés par conception (comparaisons WebGL réservées à Chromium, préexistants).
  - `npx vitest run --project worker tests/integration/adversarial.test.ts` : 22/22, trois exécutions consécutives
    identiques. `npx playwright test tests/e2e/network.spec.ts` : 9/9 (3 navigateurs, parcours AC1 44–52 s).
  - Intermédiaires : S1 échouait d'abord par la conception du test (un `ping` sur B réglait légitimement son échéance
    due sous l'horloge partagée, D43) → B décalée ; `matchId` identiques entre rooms → assertion limitée au code de
    room ; J3 : le 409 est aussi signalé nativement en console par chaque navigateur (et un avertissement WebGL sous
    Firefox) → seuls le 409, l'absence d'erreur de page et de socket sont exigés.
  - Mutations contrôlées (restaurées, fichiers comparés à leur copie), toutes détectées : sélection publiée en
    `revealedChoices` pendant la sélection → S2 et 2 autres (intégration), parcours E2E ; réponses mémorisées ignorées →
    2 tests de doublons ; échéance traitée sans vérifier qu'elle est due → 18 tests ; `console.log` du token dans le
    Worker → test des journaux ; route `/__harness/clock` ajoutée au Worker de production → garde du build. Mutation
    équivalente écartée : `isRevealedPhase` vrai en sélection ne fuit rien (garde `lastRound.roundId` en profondeur).
- Preuves / fichiers :
  - Tests : `tests/integration/adversarial.test.ts` (22 : S1, S2, 13 refus de phase, revanche en double, renvoi après
    reprise, obsolètes, room tierce en pleine partie, alarmes concurrentes + choix tardif, nul ON en ligne, journaux),
    `tests/integration/driver.ts` (pilote partagé), `tests/e2e/network.spec.ts` (AC1/S2 parcours complet, garde du
    build, sondes des routes du harnais), `tests/e2e/online-driver.ts` (console complète, `startDuel` rend code et
    tokens). Couverture déjà prouvée et citée : `game.test.ts` (double submit, alarme répétée, reconstruction, panne),
    `sockets.test.ts` (4409, isolation au lobby), `reconnect.test.ts`, `expiry.test.ts`, `lobby.spec.ts`.
  - Docs : DECISIONS (D44), TESTING (« Depuis PFC-019 »), TRACEABILITY (preuves PFC-019), tasks/README.
- Blocages / décisions nouvelles : aucun blocage. Décision D44 (choix par défaut proposé, non validé par le
  propriétaire). Limites : journaux vérifiés sur workerd local uniquement (journaux de la plateforme : PFC-020/022) ;
  aucun test de charge (hors périmètre) ; les suites d'intégration existantes gardent leurs aides locales (migration
  vers `driver.ts` possible, non faite pour éviter une refonte annexe). Prochain ticket disponible : PFC-020
  (PFC-021 dépend aussi de PFC-009, déjà done ; PFC-025 et PFC-026 restent disponibles en M1).
