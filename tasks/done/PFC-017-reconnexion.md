# PFC-017 — Déconnexion pause reprise et session

- Statut : done
- Priorité : P0
- Lot : M2
- Dépendances : PFC-016

## Contexte et objectif
Préserver l’équité et les trophées lors d’une coupure ou d’un rechargement.

## Périmètre
ResumeToken sessionStorage, reconnexion bornée, pause, deadline 30 s, reprise et annulation. Exclut migration d’hôte et forfait récompensé.

## Règles et contraintes
D15 + PROTOCOL ; conserver phase/temps restant ; délai depuis première absence ; échéances dues avant commandes arrivées à égalité.
Depuis PFC-013 (D37) : la fermeture de la socket courante persiste `connected[slot] = false` et publie l'état, sans
pause ni délai : les ajouter ici. Sockets standard : une perte d'instance (redéploiement) ferme toutes les sockets sans
événement `close` traité, la présence persistée peut donc rester vraie ; la réconcilier au réveil. Une nouvelle socket
du même token reprend la place et ferme l'ancienne en 4409 ; le client ne se reconnecte pas seul après 4409.
Depuis PFC-016 (D40) : le client affiche `paused` comme une arène sans décompte ni bannière (phase `pause`), et toute
fin de connexion (`lost`) ramène au menu en ligne ; y brancher l'écran « Connexion interrompue » de la maquette
(Réessayer, Quitter la partie) et la reprise. La chronologie (`online/game.ts`) se recale seule sur la nouvelle
échéance publiée, l'horloge (`ServerClock`) est à conserver entre deux sockets de la même room ; un choix envoyé
(`pick`) est à oublier si la reprise publie une autre manche.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| la sélection a 2 secondes restantes puis J2 se déconnecte | J2 se reconnecte 10 secondes plus tard | la sélection reprend avec 2 secondes et les mêmes choix cachés |
| la pause expire à t=30000 ms | une reconnexion arrive à t=30000 ms | la room est fermée sans trophée de forfait |

## Critères d'acceptation
- [x] AC1 : Une coupure pause sélection/résultat ; reconnexion avant 30 s restaure place, scores et temps restant.
- [x] AC2 : À 30 s ou au-delà, fermer sans trophée supplémentaire ; la nouvelle connexion ne ressuscite pas la room.
- [x] AC3 : Reconnexion après résultat final ne récompense pas deux fois ; anciennes sockets ignorées ; les deux absents restent bornés.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Déconnexion pause reprise et session
  Scénario: PFC-017-S1 — Reprise de la sélection
    Étant donné la sélection a 2 secondes restantes puis J2 se déconnecte
    Quand J2 se reconnecte 10 secondes plus tard
    Alors la sélection reprend avec 2 secondes et les mêmes choix cachés
  Scénario: PFC-017-S2 — Expiration exacte
    Étant donné la pause expire à t=30000 ms
    Quand une reconnexion arrive à t=30000 ms
    Alors la room est fermée sans trophée de forfait
```

## Tests et vérification
Intégration horloge : juste avant/à/après 30 s, deux absents, recharge, ancienne socket et déconnexion autour du commit de résultat ; E2E reconnect réel.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-017-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : terminée (2026-09-29), décision [D42](../../docs/DECISIONS.md).
  - Serveur : absence = place déjà connectée sans socket courante, constatée à chaque `#settle` (réservations → délai de
    reconnexion échu → échéance de jeu → présence), ce qui couvre fermeture, socket fermée par le serveur (4429/1011 : présence
    auparavant figée à vrai, corrigé) et instance perdue. Délai de 30 s depuis la première absence, jamais repoussé. Pause en
    `starting` (ajout au ticket : l'absent perdait sinon la première manche), `selecting`, `round-result`, reste exact persisté ;
    lobby et fin de partie : même délai, sans pause. Échéance : `room-closed {reconnect-timeout}`, 4404, effacement, aucun trophée.
    Schéma v4 + migration v3 → v4. `resumePhase` accepte `starting` (protocole partagé).
  - Client : place de l'onglet en `sessionStorage`, reprise après rechargement ; reprise bornée du lien (0, 1, 2, 4 s puis 4 s,
    30 s au plus ; tentative abandonnée à 5 s ; lien mort sans trame depuis 10 s ; événement `online`) ; requêtes en attente
    oubliées après reprise ; écran « Connexion interrompue » de la maquette (« Reconnexion… », « Joueur N ne répond plus » avec
    décompte), dialogue d'alerte modal, focus géré, transitions, toasts « Connexion rétablie. ». Arène affichée en pause pendant
    sa propre coupure. Démontage sans « Quitter » = coupure (StrictMode sûr).
- Commandes exécutées / résultats (Node 24.21.0 via `nvm use`) :
  - `npm run verify` final : build (`tsc -b`, `vite build`, `wrangler deploy --dry-run`) OK ; `vitest run` 44 fichiers,
    676 tests OK ; `eslint . --max-warnings=0` OK ; Playwright 200 tests OK (Chromium, Firefox, WebKit), code de sortie 0.
  - Exécutions intermédiaires consignées : un `verify` arrêté au fonctionnel (2 tests à ajuster après la tentative immédiate
    et le saut de ligne du sous-titre, dont un vrai défaut d'accessibilité corrigé : description « pause.Les ») ; un `verify`
    avec 3 échecs E2E de PFC-015-AC1 (le test imposait « token jamais stocké », contrat que D39 reportait à PFC-017 : assertion
    réécrite au contrat D42 — jamais en localStorage, URL, DOM, journal ni lien ; en sessionStorage sous la seule clé de reprise) ;
    un `verify` arrêté au lint (2 erreurs de typage du test) ; puis le `verify` final vert.
  - `npm run baseline:mockup -- --only online-lost` : 4 références capturées depuis la maquette (aucune autre réécrite).
  - Mutations contrôlées (restaurées), détectées : délai de reconnexion repoussé à chaque absence ; délais de reprise du client.
- Preuves / fichiers :
  - Tests : `tests/integration/reconnect.test.ts` (18 : S1, S2, 29 999 ms, ouverture, résultat, choix en pause, échéance exacte
    et −1 ms, alarme, deux absents, lobby, fin de partie, dernier résultat repris/expiré, 4409, instance perdue ×2),
    `tests/integration/storage.test.ts` (schéma v4, migration), `tests/unit/client/OnlineReconnect.test.tsx` (16),
    `tests/unit/client/roomConnection.test.ts` (reprise bornée), `tests/unit/protocol/{projection,server}.test.ts`,
    `tests/e2e/reconnect.spec.ts` (3 × 3 navigateurs), `tests/e2e/visual.spec.ts` (`online-lost`, `online-lost-retry`, bureau et
    téléphone, pixel exact) ; tests PFC-012/013/014 adaptés (présence par vraies sockets, pause après départ des deux).
  - Code : `src/worker/{room,game,seats,codec,storage,reservations}.ts`, `src/shared/protocol/{state,server,socket,index}.ts`,
    `src/client/online/{connection,useOnlineRoom,messages,session}.ts`, `src/client/screens/OnlineScreen.tsx`,
    `src/client/screens/online/ConnectionLost.{tsx,css}`, `src/client/Stage.tsx`.
  - Docs : DECISIONS (D42), PROTOCOL (« Absence, pause et reprise », client, `resumePhase`), ARCHITECTURE, SPEC, TESTING,
    TRACEABILITY, PFC-018 (note de reprise).
- Blocages / décisions nouvelles : aucun blocage. Décisions : D42 (dont l'arbitrage du propriétaire sur le sous-titre, 2026-09-29).
  Limites : instance perdue au lobby ou en fin de partie sans retour d'aucun client ni alarme → fermée au prochain réveil
  (alarmes d'inactivité et de durée maximale : PFC-018) ; « Quitter la partie » pendant sa propre coupure ne peut pas envoyer
  `leave` : la room se ferme à l'échéance de 30 s (l'adversaire voit « n'est pas revenu ») ; rendu 3D sur vrai GPU non mesuré
  (PFC-021). Prochain ticket disponible : PFC-018.
