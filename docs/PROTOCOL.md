# Contrat réseau v1 — cible d'implémentation

## Transport et entrée dans une room
HTTPS puis WSS en production, même origine ; HTTP/WS uniquement en développement local.
`POST /api/rooms` crée et réserve J1 ; `POST /api/rooms/:code/join` réserve J2 atomiquement.
Réponse privée : code, place et resumeToken aléatoire de 256 bits. Collision de code : nouvelle
tentative sans écraser la room existante, maximum 5 puis erreur réessayable.
Code : 8 caractères de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, normalisé trim + uppercase.
Le code invite à rejoindre ; il ne permet jamais de reprendre une place réservée.
Une réservation non connectée expire au bout de 30 s ; si J1 ne se connecte pas, fermer la room ;
si J2 ne se connecte pas avant toute partie, libérer uniquement J2. Après début : D15 s'applique.
Ne jamais accepter une troisième place, y compris lors d'arrivées concurrentes.

### Entrée HTTP (PFC-012, D36)
| Requête | Succès | Refus |
| --- | --- | --- |
| `POST /api/rooms` | `201 { roomCode, slot: 0, resumeToken }` | `503 CODE_COLLISION` (+ `Retry-After: 1`) après 5 codes déjà pris |
| `POST /api/rooms/:code/join` | `200 { roomCode, slot: 1, resumeToken }` | `404 ROOM_UNAVAILABLE` (code mal formé, inconnu, expiré ou fermé) ; `409 ROOM_FULL` ; `503 ROOM_UNAVAILABLE` (état illisible) |

- Aucun corps de requête n'est lu ; la réponse est validée côté client par `parseRoomEntry` (`src/shared/protocol`),
  clés exactes, code canonique, `slot` 0 ou 1, token 256 bits. Elle est `no-store` comme toute réponse de l'API.
- `:code` est décodé puis normalisé (trim + majuscules) ; un code mal formé n'atteint aucune room. Un code inconnu,
  expiré ou fermé reçoit la même réponse qu'un code jamais émis : aucun oracle d'énumération.
- La room ne reçoit et ne conserve que le SHA-256 hexadécimal du token ; le token n'existe qu'en réponse.
- Réservation : J2 seulement au lobby avant toute partie. Une échéance égale à l'instant de la requête est échue et
  traitée avant elle (J2 libéré puis réattribué, ou room fermée). Une room fermée est entièrement effacée.
- Toute autre méthode sur ces deux routes : `405 METHOD_NOT_ALLOWED` avec `Allow: POST`.

### Erreurs HTTP (PFC-011)
Toute réponse d'erreur de l'API est du JSON `{ "error": { "code", "message" } }` (`application/json; charset=utf-8`,
`cache-control: no-store`, `x-content-type-options: nosniff`), message français fixe par code, sans pile ni donnée
reçue. `/api` et `/api/*` atteignent toujours le Worker avant les fichiers statiques : une route inconnue répond
`404 NOT_FOUND`, jamais `index.html`. `503 ROOM_UNAVAILABLE` : état de room illisible ; `500 INTERNAL` : erreur
inattendue. Les tickets suivants ajoutent leurs routes et codes (PFC-012 : `ROOM_FULL`, `CODE_COLLISION`,
`METHOD_NOT_ALLOWED`, `404 ROOM_UNAVAILABLE` ; PFC-013 : `403 ORIGIN_FORBIDDEN`, `426 UPGRADE_REQUIRED`,
`405 METHOD_NOT_ALLOWED` avec `Allow: GET` sur la route de socket ; PFC-020 : `RATE_LIMITED`).

`GET /api/rooms/:code/ws` ouvre la socket ; premier message `authenticate` avec resumeToken
sous 5 s, sinon fermeture sans donnée de room. Valider Origin contre une allowlist explicite.
Ne pas placer le token dans une URL. Stockage client en sessionStorage limité à la room ;
retirer au départ/expiration. Stockage serveur du hash uniquement. Comparaison sûre.
Une nouvelle connexion authentifiée de la même place remplace l'ancienne ; seule la nouvelle
génération de socket peut écrire. Les token hashes sont effacés à la fermeture de room.

### WebSocket (PFC-013, D37)
Constantes partagées : `src/shared/protocol/socket.ts` (`AUTH_TIMEOUT_MS`, `SOCKET_CLOSE_CODES`, limites, `roomSocketPath`).

| Étape | Refus |
| --- | --- |
| `GET /api/rooms/:code/ws`, filtré par le Worker avant toute room | autre méthode : `405 METHOD_NOT_ALLOWED` + `Allow: GET` ; sans `Upgrade: websocket` : `426 UPGRADE_REQUIRED` ; `Origin` absente, `null` ou différente de l'origine du Worker : `403 ORIGIN_FORBIDDEN` ; code mal formé : `404 ROOM_UNAVAILABLE` |
| Upgrade accepté par la room | room inconnue, expirée, fermée ou illisible : trame `error ROOM_UNAVAILABLE`, puis fermeture **4404** (le navigateur ne lit pas le statut HTTP d'un upgrade refusé) |
| Attente d'`authenticate`, 5 s depuis l'acceptation (horloge serveur) | aucune trame reçue à temps, ou reçue à l'instant exact de l'échéance : fermeture **4408** sans aucune trame |
| Première trame | toute autre trame (schéma invalide, binaire, trop grande, autre commande) : `error` (code du refus, `requestId` s'il est valide) puis **4401** ; aucune donnée de room |
| `authenticate` : SHA-256 du token comparé à temps constant aux deux places | place inconnue, ou libérée faute de première connexion à temps : `error UNAUTHORIZED` puis **4401** |

- Allowlist d'Origin : exactement l'origine de la requête reçue par le Worker (front et API sur la même origine, en dev,
  preview et production) ; ni liste configurable, ni joker, ni réflexion. Le client ne désigne jamais sa place : elle
  vient de l'empreinte du token.
- Succès, en une transition synchrone : `reservedUntil = null` et `connected[slot] = true` (écrits seulement s'ils
  changent) ; l'ancienne socket de la place est fermée en **4409** ; puis `state` projeté à chaque socket authentifiée
  si la présence a changé (sinon à la nouvelle seule), puis `ack {requestId, revision}` à la nouvelle. Le client
  reçoit donc son premier `state` avant l'ack.
- Socket authentifiée : trames traitées une à une dans l'ordre d'arrivée ; un refus renvoie `error` sans fermer.
  Second `authenticate` : `INVALID_PHASE`. `ping` → `pong`, sans écriture. Commandes de jeu autorisées par
  `authorizeCommand` : transition de PFC-014 (voir « Machine à états serveur ») ; refusées : leur code (ex. `NOT_HOST`).
- Fermeture de la socket courante d'une place : `connected[slot] = false` persisté et publié à l'autre joueur ; la
  place reste réservée (reprise par le même token), avec pause et délai de reconnexion (voir « Absence, pause et
  reprise »). Une socket remplacée ou refusée n'a plus aucun effet.
- Limites par connexion : chaque trame consomme un jeton (20/s, rafale 30) ; seau vide → `error RATE_LIMITED` ;
  trame > 4 096 octets (texte UTF-8 ou binaire) → `error INVALID_MESSAGE` ; ces deux dépassements, trois fois de
  suite, ferment en **4429**. Une trame dans les limites remet le compteur à zéro. Erreur interne : **1011**.

| Code | Sens pour le client |
| --- | --- |
| 4401 | token refusé ou première trame invalide : oublier le token, rejoindre à nouveau |
| 4404 | room absente, expirée, fermée ou illisible |
| 4408 | authentification trop tardive : rouvrir une socket et s'authentifier aussitôt |
| 4409 | un autre onglet a repris la place : ne pas se reconnecter automatiquement (sinon bascule sans fin) |
| 4429 | trois dépassements consécutifs de taille ou de débit |

### Client en ligne (PFC-015, D39)
- Invitation : `<origine>/p/<CODE>`, jamais de token ; la SPA sert ce chemin, préremplit « Rejoindre » puis remplace
  l'adresse par `/`. Le code saisi est normalisé côté client (`codeFromInput`) avant tout `POST .../join`.
- Token : mémoire de la connexion et `sessionStorage` de l'onglet (`elem3nts.room.v1` : code, place, token), jamais
  dans l'URL, le DOM ni un journal ; retiré à « Quitter », à toute fin de connexion et au démontage (PFC-017).
- Réaction aux fermetures : 4408 d'une première connexion → une réouverture authentifiée aussitôt ; 4401 → token
  oublié ; 4409 → aucune reconnexion ; `room-closed {reason}`, 4404, 4429 → message explicite, retour au menu ;
  toute autre fermeture → reprise bornée (PFC-017, ci-dessous).
- `update-settings` : une commande à la fois, avec la `settingsRevision` du dernier `state` ; `ready` n'est pas
  envoyé tant qu'un changement de l'hôte n'est pas publié.

### Partie en ligne côté client (PFC-016, D40)
- Le client n'affiche que la vérité du dernier `state` accepté (révision ≥ la précédente) : phase, scores, résultat,
  trophées et confirmations. Aucune résolution locale ; l'horloge locale ne fait que choisir, dans la chronologie
  déjà publiée, le moment à montrer (révélation, effet, impact, résultat, suite), à partir de
  `deadline − roundResultMs(kind, suite)` ; la sélection reste affichée, décompte à zéro, jusqu'à l'état suivant.
- Horloge : décalage = plus grand `serverNow − instant de réception` observé (`state`, `pong`), monotone ; `ping`
  dès l'`ack` d'authentification puis toutes les 5 s (latence affichée, jamais d'effet sur l'expiration).
- `submit-choice` : une fois par manche, avec `matchId` et `roundId` du `state` courant, touches de Joueur 1 ou
  boutons ; aucune place transmise. Refus `STALE_ROUND`/`INVALID_PHASE` : choix affiché retiré, message « trop tard ».
- `rematch-ready` : une fois, avec le `matchId` terminé et la `settingsRevision` publiée ; jamais pendant l'envoi de
  réglages de l'hôte ; `update-settings` de l'hôte accepté aussi en `match-ended` (retire les confirmations).
- `leave` depuis la partie ou sa fin : retour à l'accueil ; l'autre joueur reçoit `room-closed {left}`.

### Absence, pause et reprise (PFC-017, D42)
Constante partagée : `RECONNECT_TIMEOUT_MS` = 30 000 (`src/shared/protocol/socket.ts`).

| Événement | Phase | Effet |
| --- | --- | --- |
| place déjà connectée sans socket courante (fermeture, socket fermée par le serveur, instance perdue) | `starting`, `selecting`, `round-result` | `paused`, `resumePhase` = phase, reste persisté, `deadline` publiée = reconnexion ; `connected` publié |
| idem | `lobby`, `match-ended` | place absente, confirmation retirée, même délai ; aucune pause |
| idem | `paused` | place absente ; délai inchangé |
| retour authentifié, plus aucune place absente | `paused` | phase reprise, `deadline = maintenant + reste`, mêmes choix cachés |
| retour authentifié, une autre place encore absente | `paused` | pause maintenue, même échéance |
| délai de reconnexion ≤ maintenant | toute phase ouverte | `closed` persisté, `room-closed {reconnect-timeout}`, 4404, stockage effacé ; aucun trophée |

- Le délai part de la première absence et n'est jamais repoussé (seconde absence, retour partiel, tentatives).
- Ordre à instant égal, avant toute commande, `fetch` ou `join` : réservations → délai de reconnexion → échéance de
  jeu → présence. Une reconnexion arrivée à l'échéance exacte trouve la room fermée (4404) et ne la recrée jamais ;
  une coupure à l'échéance exacte d'une sélection la résout d'abord, puis met le résultat en pause.
- Une instance reconstruite n'a aucune socket : toute présence persistée est réconciliée en absence au premier
  événement (alarme, socket, join).
- Client : fermeture non décidée par le serveur → tentative aussitôt, puis à 1, 2, 4 s et toutes les 4 s, au plus
  30 s après la coupure (`lost`) ; tentative sans issue abandonnée à 5 s ; événement `online` → tentative immédiate ;
  sans trame du serveur depuis 10 s (pings toutes les 5 s) → lien tenu pour mort. 4404 pendant la reprise :
  « fermée pendant la coupure ». Horloge serveur et dernière révision conservées d'une socket à l'autre ; après la
  reprise, les commandes sans réponse sont oubliées (renvoyables), le choix affiché n'est gardé que si l'état publie
  son verrou pour la même manche.
- « Réessayer » en ligne : nouvelle socket authentifiée ; la place étant déjà présente, le serveur n'écrit rien et
  ferme l'ancienne en 4409, ignorée par le client.

### Inactivité et durée maximale (PFC-018, D43)
Constantes partagées : `ROOM_IDLE_TIMEOUT_MS` = 30 min, `ROOM_MAX_DURATION_MS` = 4 h (`src/shared/protocol/socket.ts`).

| Échéance | Instant | Motif |
| --- | --- | --- |
| inactivité | dernière activité utile (`lastActivityAt`) + 30 min | `inactive` |
| durée maximale | création (`createdAt`) + 4 h, absolue, pause comprise | `max-duration` |
| reconnexion | première absence + 30 s (ci-dessus) | `reconnect-timeout` |

- Activité utile : création, première connexion d'une place, commande acceptée qui modifie la room (réglages
  changés, confirmation, choix verrouillé). Jamais : `ping`, refus, commande sans effet, reprise de place, réservation
  HTTP seule, échéance traitée ; une manche sans aucun choix (R12) continue la partie sans prolonger la room.
- Échéance ≤ maintenant : échue, traitée avant toute commande, `ping`, socket ou `join` du même instant, et avant
  l'échéance de jeu due au même instant. Plusieurs échues : motif de la plus ancienne ; à égalité,
  `reconnect-timeout` › `max-duration` › `inactive`.
- Fermeture : `closed` persisté, `room-closed {reason}` à chaque joueur présent, 4404, socket non authentifiée fermée
  (`ROOM_UNAVAILABLE`, sans donnée), alarme annulée, stockage effacé. Partie en cours annulée, aucun trophée ; aucun
  `join` ni socket ne recrée la room (code inconnu, 404 / 4404).
- Client : message lisible (« Partie fermée après 30 minutes sans activité : aucun trophée attribué. »,
  « … durée maximale de 4 heures atteinte, aucun trophée attribué. »), retour au menu en ligne, place oubliée ;
  notification persistante jusqu'à sa fermeture.

## Enveloppe de commande authentifiée
```json
{
  "v": 1,
  "type": "submit-choice",
  "requestId": "identifiant-unique-client",
  "matchId": "match-42",
  "roundId": 2,
  "payload": { "element": "fire" }
}
```
Le joueur vient de la socket authentifiée, jamais d'un playerId fourni par le client.
`matchId` et `roundId` sont requis pour submit-choice ; pour les autres commandes,
valider le contexte lobby/match décrit par le schéma. Les nombres sont bornés et entiers.
Chaque état expose settingsRevision. Les commandes update-settings, ready et rematch-ready
portent expectedSettingsRevision ; rejeter STALE_SETTINGS si elle ne correspond plus. Une
modification acceptée incrémente settingsRevision et retire les confirmations. Ainsi, un ready
retardé ne valide jamais silencieusement des réglages que le joueur n’a pas encore vus.
`authenticate` est l'unique message autorisé avant authentification ; aucune donnée publique avant.

| Commande | Contexte | Effet autorisé |
| --- | --- | --- |
| update-settings | lobby ou match terminé ; J1 seulement | X et nul ; retirer toutes les disponibilités |
| ready | lobby, deux places connectées | marquer prêt ; deux prêts démarrent |
| submit-choice | selecting, bon matchId/roundId | premier choix verrouillé |
| rematch-ready | match terminé | deux confirmations lancent nouvelle partie |
| leave | toute phase | fermer la room ; pas de trophée supplémentaire |
| ping | connecté | pong ; ne prolonge pas l'expiration d'inactivité |

### Schémas v1 (PFC-010, `src/shared/protocol/`)
Toute commande a exactement `v`, `type`, `requestId` et `payload` (objet, `{}` pour leave/ping),
plus son contexte de partie ; toute autre clé, dans l'enveloppe comme dans le payload, est refusée.

| Commande | Contexte d'enveloppe | Payload exact |
| --- | --- | --- |
| authenticate | — | `{resumeToken}` |
| update-settings | — | `{expectedSettingsRevision, settings: {target, drawEnabled}}` |
| ready | — | `{expectedSettingsRevision}` |
| submit-choice | `matchId`, `roundId` | `{element: fire, water ou plant}` |
| rematch-ready | `matchId` de la partie terminée | `{expectedSettingsRevision}` |
| leave, ping | — | `{}` |

- Identifiants : `requestId` et `matchId` de 1 à 64 caractères `[A-Za-z0-9_-]` ; `roundId` entier ≥ 1
  numéroté dans la partie ; révisions entières ≥ 0 ; bornes : entiers sûrs JavaScript.
- `resumeToken` : 32 octets aléatoires en base64url sans remplissage (43 caractères canoniques).
- Trame : texte uniquement (binaire refusé), 4 096 octets UTF-8 au plus, mesurés avant `JSON.parse`.
- Version : `v` absent ou non entier → INVALID_MESSAGE ; autre entier que 1 → VERSION_UNSUPPORTED.
- Réglages : forme ou types faux → INVALID_MESSAGE ; X non entier ou hors 1–10 → INVALID_SETTINGS.
- `error.requestId` n'est renvoyé que s'il est lui-même valide ; le message d'erreur est fixe par code
  et ne recopie aucune donnée reçue. Le motif technique du refus (`reason`) reste côté serveur (logs).
- Ordre des gardes après validation : room fermée (ROOM_UNAVAILABLE) → non authentifié (UNAUTHORIZED) →
  hôte (NOT_HOST) → partie/manche visée (STALE_ROUND) → phase (INVALID_PHASE) → verrou (CHOICE_LOCKED)
  ou révision des réglages (STALE_SETTINGS). Un second `authenticate` sur une socket authentifiée :
  INVALID_PHASE. `ready` sans les deux places connectées : INVALID_PHASE.

## Réponses et projection
`ack {requestId, revision}` ou `error {requestId?, code, message}` ; le message humain est français.
`state {v, revision, serverNow, roomCode, yourSlot, phase, resumePhase?, matchId, roundId, settings,
settingsRevision, scores, trophies, ready, connected, choiceLocked, deadline?, revealedChoices?, result?,
matchResult?}`. Tous les messages serveur portent `v` et `type`.
- `yourSlot` 0 (J1) ou 1 (J2) ; `ready`, `connected`, `choiceLocked` : paires de booléens J1/J2
  (`connected` sert l'attente du lobby et la pause ; `choiceLocked` ne dit jamais quel élément).
- `resumePhase` (`starting`, `selecting` ou `round-result`) seulement en `paused` ; `deadline` (ms serveur absolues)
  seulement en `selecting`, `round-result` et `paused`.
- `revealedChoices` et `result {kind, winner, delta}` (D25) ensemble, seulement en `round-result`,
  `match-ended` ou pause survenue au résultat, et pour la manche courante (`roundId`) uniquement.
- `matchResult` (`{status: won, winner}` ou `{status: draw}`) seulement en `match-ended`.
`room-closed {reason}` termine la session ; `reason` : `left`, `inactive`, `max-duration` ou
`reconnect-timeout`. `pong {requestId, serverNow}` : le client estime latence et décalage à partir de
l'instant d'envoi de son `ping`.
La projection est construite explicitement par allowlist, jamais par sérialisation du stockage brut.
Pendant sélection/pause avant révélation : pas d'éléments, même dans un ack, une
reconnexion, une erreur ou un message debug. Après révélation uniquement, revealedChoices est présent.
Les tokens/hashes ne font jamais partie d'un state. Le client ignore les revisions plus anciennes.
Le client valide aussi chaque trame serveur (`parseServerMessage`, clés exactes et cohérence de phase) et
ignore une trame refusée.

## Machine à états serveur
`lobby → starting → selecting → round-result → selecting` ; `starting` est l'ouverture d'une partie
(bannière D09, 2,2 s, aucun choix accepté) ; `selecting` porte une deadline de 5 s (D08),
résolue à échéance même si un choix ou les deux manquent (R11/R12).
Après le résultat de la manche gagnante : `round-result → match-ended` ; revanche : `match-ended → starting`.

### Transitions (PFC-014, D38)
Chronologie partagée avec le mode local (`src/shared/cycle.ts`) ; chaque échéance suivante part de l'instant où la
précédente est traitée (une alarme en retard n'écourte aucune fenêtre et ne rattrape rien en rafale).

| Depuis | Événement | Vers | Effet |
| --- | --- | --- | --- |
| lobby | second `ready` (deux places connectées) | starting | nouveau `matchId` (`m-<revision>`), `roundId` 1, confirmations retirées, deadline +2 200 ms |
| starting | échéance | selecting | deadline +5 000 ms ; les choix ne l'avancent jamais |
| selecting | `submit-choice` | selecting | premier choix verrouillé ; `choiceLocked` publié, jamais l'élément |
| selecting | échéance | round-result | résolution unique avec le moteur partagé (R02–R12) ; deadline + `roundResultMs(kind, suite)` = révélation (1 100 ms, 500 sans choix) + effet D + 1 600 ms + pause 800 ms, mort subite 2 500 ms ou fermeture 700 ms |
| round-result | échéance, partie en cours | selecting | `roundId` + 1, choix effacés, deadline +5 000 ms |
| round-result | échéance, partie finie | match-ended | trophées réglés une fois (`settledMatchId`), confirmations retirées, aucune deadline |
| lobby, match-ended | `update-settings` (J1) | inchangée | réglages et `settingsRevision` + 1, confirmations retirées ; réglages identiques : `ack` sans écriture |
| match-ended | second `rematch-ready` (deux places connectées) | starting | nouveau `matchId`, scores 0/0, trophées conservés |
| toute phase | `leave` | closed | partie en cours annulée sans trophée ; `room-closed {left}` aux deux, `ack` au demandeur, fermeture 4404, stockage effacé |

- Ordre des réponses : transition persistée, puis `state` à chaque place, puis `ack {requestId, revision}` au demandeur.
  Une confirmation déjà donnée est acquittée à la révision courante, sans écriture.
- La fermeture de la socket courante d'une place, au lobby ou en fin de partie, retire aussi sa confirmation ;
  une confirmation n'est comptée qu'avec les deux places connectées.
- Un client déduit l'instant de révélation de la deadline du résultat : `deadline - roundResultMs(kind, suite)`.
- Échec d'écriture : rien n'est publié ; sur une commande, la socket est fermée en 1011 ; sur une alarme, le
  runtime la relance.
Déconnexion en cours (PFC-017, tableau « Absence, pause et reprise ») : `paused`, avec phase/temps restant stockés ;
reconnexion des deux avant l'échéance : reprendre la phase sauvegardée avec une nouvelle deadline.
Si les deux sont absents, le délai part de la première absence ; ne pas le repousser à chaque tentative.
Au-delà de 30 s : `closed`, annulation sans trophée. En lobby ou match-ended, ne lancer aucun match
avec un absent ; le délai de reconnexion reste applicable aux places déjà connectées.
À timestamp égal, traiter les échéances dues avant la nouvelle commande : une reconnexion arrivée
à l'échéance est trop tardive. Le TTL max de 4 h reste absolu même pendant une pause (PFC-018,
« Inactivité et durée maximale »).
Une interruption pendant round-result ne remet jamais en cause le score déjà persisté.

## Idempotence et validation
Dédupliquer requestId par place dans une fenêtre bornée (128 dernières réponses). Rejouer la
réponse sans mutation. PFC-014 : seules les commandes acceptées qui modifient la room sont mémorisées, dans la
même écriture que leur transition ; un doublon reçoit le même `ack`, avant toute garde. Un refus n'écrit rien :
rejoué, il est réévalué. Au-delà du cache, les gardes de phase, choix verrouillé, matchId/roundId
et l'attribution persistée par matchId empêchent toute double résolution/récompense.
Les messages invalides ne modifient pas l'état ni les délais ; payload inconnu rejeté.
Limiter les messages à 4 KiB et 20/s/connexion (burst 30). Après 3 dépassements consécutifs,
fermer la connexion ; appliquer la politique de reconnexion sans récompense de forfait.
Limiter create/join à 10/minute par IP au point d'entrée, avec mécanisme atomique partagé
(binding rate limit adapté à l'offre ou Durable Object dédié), jamais un compteur global en mémoire Worker.
Documenter portée et limites de ce rate limit dans PFC-020 ; vérifier la protection des upgrades aussi.
Codes : INVALID_MESSAGE, INVALID_SETTINGS, ROOM_UNAVAILABLE, ROOM_FULL, UNAUTHORIZED,
NOT_HOST, INVALID_PHASE, STALE_ROUND, STALE_SETTINGS, CHOICE_LOCKED, RATE_LIMITED, VERSION_UNSUPPORTED.
Pas de stack trace ou contenu sensible envoyé au client.

## Journalisation et nettoyage
Logs structurés : type d'événement, identifiant technique de room non secret, matchId, roundId,
revision, code d'erreur et durée. Aucun choix avant révélation, token ou corps complet de message.
Activité utile = commande valide qui modifie l'état, ou première connexion d'une place (D43) ; ping, tentatives
rejetées et reprises de place ne prolongent rien.
À fermeture : annuler alarme, fermer sockets, supprimer état sensible ; conserver au plus une tombstone
technique bornée si nécessaire à l'idempotence. Un join sur room absente/expirée ne la recrée jamais.
