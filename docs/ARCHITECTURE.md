# Architecture cible

## Découpage du dépôt à créer
- `src/domain/` : types, moteur pur, transitions de partie et résultat de manche.
- `src/shared/` : contrat réseau, schémas de validation et projections publiques.
- `src/client/` : React, contrôleur local, client réseau, UI et styles.
- `src/client/scene/` : Three.js uniquement pour le rendu ; initialisation, mise à jour, destruction.
- `src/worker/` : routeur Worker, room Durable Object, stockage, échéances et validation serveur.
- `tests/unit/`, `tests/integration/`, `tests/e2e/` : Vitest, runtime Workers, Playwright Microsoft.
- `docs/`, `tasks/`, `.claude/` : contrat et suivi.
Un seul package npm au départ ; pas de monorepo/outillage additionnel sans besoin concret.

## Frontières
Le moteur accepte état + événement validés et renvoie un nouvel état/résultat sans effet de bord.
Ne jamais importer React, DOM, Three.js, réseau, horloge système ou API Worker dans le domaine.
Le contrôleur local fournit événements et temps ; le serveur fait de même en ligne.
L'UI affiche l'état public sans modifier les scores ; Three.js reçoit un événement de révélation
identifié et ne décide ni du résultat ni du passage à la manche suivante.
Préférer des unions discriminées pour les phases et des transitions exhaustives.

## Hébergement
Proposition : Cloudflare Worker servant l'API et les fichiers statiques Vite, Durable Object
SQLite par room. Les requêtes `/api/*` et l'upgrade WebSocket atteignent le Worker avant le
fallback SPA ; les routes API inconnues renvoient du JSON 404, jamais index.html.
Les chemins front rechargés doivent servir la SPA. Isoler staging et production : noms,
bindings, migrations et secrets. Configurer la migration initiale du Durable Object.
Pas de serveur Express ni de runtime Node permanent pour les sockets.

### Environnements, CI et livraison (PFC-022, D48)
- `wrangler.jsonc` : racine = production (Worker `elem3nts`) ; `env.staging` = Worker `elem3nts-staging`
  (https://elem3nts-staging.elem3nts.workers.dev), donc namespaces Durable Object et stockage distincts. Liaisons et
  migrations, non héritées par un environnement, y sont répétées ; `tests/integration/config.test.ts` impose l'égalité.
  Aucune variable ni secret côté Worker : seul le déploiement demande un accès Cloudflare.
- L'environnement se choisit **au build** (`CLOUDFLARE_ENV`, plugin Vite) : `dist/elem3nts/wrangler.json` est aplati
  pour sa cible. L'artefact vérifié est donc propre à une cible ; `scripts/deploy.ts` (`npm run deploy:*`) le publie tel
  quel (`wrangler deploy --config dist/elem3nts/wrangler.json --strict`), refuse celui d'une autre cible et étiquette
  la version avec le commit.
- `.github/workflows/ci.yml` : job `verify` (`CLOUDFLARE_ENV=staging`, `npm ci` puis les quatre gates dans l'ordre),
  artefact `dist/` conservé 7 jours ; job `deploy-staging` à la demande seulement (`workflow_dispatch`, depuis `main`),
  après `verify`, sans rebuild, puis smoke deux joueurs (`tests/smoke/`). La production n'est jamais publiée par la CI.

## État et atomicité
Une room est l'autorité unique pour deux places. Réserver les places atomiquement.
Persister après transition : session/room, matchId, roundId, revision, phase, settings,
scores, trophées, choix privés, état de présence, échéances, token hashes et fin récompensée.
Le moteur reste pur ; le stockage transactionnel et la publication viennent du serveur.
Persister avant de publier : en cas d'échec ne diffuser ni résultat ni trophée non enregistré.
Le point de linéarisation est la transition validée et persistée, pas le rafraîchissement UI.
Restaurer l'état durable au réveil ; les seules variables en mémoire ne suffisent pas.
L'identité d'une socket (en mémoire de l'instance, D37) identifie la connexion, pas une seconde vérité métier.

## Échéances
Privilégier les alarmes Durable Object pour le prochain événement dû. Stocker les échéances
absolues et traiter à chaque événement/alarm les échéances dépassées de façon idempotente.
Une seule alarme est planifiée sur la plus proche échéance parmi fin de sélection, résultat,
reconnexion, expiration et durée maximale. Au réveil, réconcilier puis replanifier.
Les clients peuvent interpoler l'affichage avec serverNow, jamais conclure eux-mêmes la manche.

## Stack et compatibilité
TypeScript strict ; React + Vite ; Three.js direct initialement ; ESLint ; Vitest + Testing Library ;
Playwright de Microsoft ; Wrangler et intégration de tests officielle Workers adaptée à la version.
Choisir des versions stables compatibles lors de PFC-001, figer lockfile et version Node LTS
supportée par tous les outils. Ne pas supposer que Workers fournit toutes les API Node.

Conserver exactement ce champ dans package.json :
```json
"browserslist": [
  "defaults and fully supports es6-module",
  "maintained node versions"
]
```
Activer Autoprefixer via PostCSS. Browserslist ne configure pas automatiquement les cibles JS
Vite ; documenter build.target, vérifier les navigateurs réellement pris en charge et les API
utilisées. Les préfixes CSS ne sont pas des polyfills JS. Node est une cible d'outillage,
pas un navigateur à tester. Fallback DOM si WebGL indisponible ou contexte perdu.

### Socle retenu (PFC-001, 2026-09-27)
- Node 24 LTS « Krypton » : `.nvmrc` = 24.21.0, `engines` = `>=24.20.0 <25` (deux versions prouvées),
  `engine-strict` et `save-exact` dans `.npmrc` ; npm 11.19.0. Toutes les dépendances sont exactes.
- React 19.3, Vite 8.3 (Rolldown), TypeScript 6.0, ESLint 10, Vitest 5, Playwright 1.63. Motifs
  des versions non « latest » : [DECISIONS D24](DECISIONS.md).
- Projets TypeScript : `tsconfig.domain.json` (domaine pur, depuis PFC-002), `tsconfig.app.json` (client),
  `tsconfig.test.json` (tests Vitest), `tsconfig.node.json` (configurations, scripts, E2E) ; options
  strictes communes dans `tsconfig.base.json`. `npm run build` = `tsc -b` (tous les projets) puis `vite build`.
- Requête Browserslist résolue le 2026-09-27 (`npx browserslist`) : chrome 109 à 154, edge 150–152,
  firefox 140 à 156, safari 26.5–27, ios_saf 18.5 à 27, opera 134–135, samsung 29–30, and_chr 152,
  and_ff 156, android 152, op_mob 80, and_uc 15.5, and_qq 14.9, kaios 3.0–3.1, node 22/24/26.
- `build.target` = `cssTarget` = `chrome109, edge150, firefox140, safari18.5, ios18.5, opera134` :
  minimum de chaque moteur résolu connu de Vite ([D21](DECISIONS.md)). Le test
  `tests/tooling/browser-targets.test.ts` échoue si une mise à jour de caniuse-lite fait descendre
  un minimum sous la cible déclarée. Conséquence pour les tickets suivants : Chrome 109 ne gère pas
  `oklch()` ni certaines API récentes ; vérifier chaque API avant usage ou prévoir un repli.
- Autoprefixer via `postcss.config.js` ; vérifié dans le bundle (`-webkit-user-select`) et par test.
- Polices de la maquette auto-hébergées dans `src/client/assets/fonts/` ([D23](DECISIONS.md)).
- Jetons de design (couleurs, polices, durées, courbes, focus) : `src/client/styles/tokens.css`.
  Toute nouvelle valeur visuelle, transition ou notification passe par ces jetons.

### Domaine pur (PFC-002, 2026-09-27)
- Point d'entrée unique `src/domain/index.ts`, partagé par le client et le futur Worker.
  `resolveRound(scores, choices)` renvoie un résultat gelé : `kind`, `winner`, `before`, `after`
  et `delta` effectif ([D25](DECISIONS.md)). Il lève une `RangeError` si un score n'est pas un entier
  de 0 à `MAX_SCORE`, ou si un élément est inconnu.
- Partie et session (PFC-003, [D26](DECISIONS.md)) :
  - `startMatch(id, settings)` : matchId injecté ;
  - `playRound(match, choices)` : manche puis évaluation de la fin, dans une seule transition ;
  - `evaluateMatch` : R07/R08 ;
  - `cancelMatch` ;
  - `startSession()` et `settleMatch(session, match)` : trophées une seule fois par matchId.
  Les transitions interdites lèvent `DomainError` (`MATCH_OVER`, `MATCH_NOT_OVER`) sans modifier l'état ;
  un doublon est un no-op (`applied: false`). Le domaine ne connaît ni roundId, ni phases de cycle,
  ni horloge : le contrôleur local (PFC-006) et le serveur (PFC-014) les portent.
- La pureté est garantie par trois barrières :
  - `tsconfig.domain.json` (`lib` ES2023 sans DOM, `types: []`) rend inconnus `document`,
    `setTimeout` et `process`. Le test `tests/tooling/domain-purity.test.ts` le prouve.
  - `tsconfig.domain.json` ne bloque pas les imports de paquets. ESLint le fait sur `src/domain/**` :
    il interdit react, three, `node:`, `cloudflare:` et les autres couches, ainsi que `Date`,
    `Math.random`, `performance`, `crypto`, `globalThis`, `console` et `process`.
  - Les tests du domaine tournent dans le projet Vitest `domain`, environnement Node sans jsdom ni setup.
    Les autres tests restent dans le projet `client`.

### Client : accueil, règles et réglages (PFC-004, 2026-09-28)
- `App` affiche l'écran d'ouverture au moins 600 ms (`SPLASH_MIN_MS`, pas de flash de l'écran de marque)
  et jusqu'au chargement des polices des écrans (délai maximal de 3 s). `Stage` n'est **pas** découpé en
  chunk paresseux : sous WebKit, l'échec d'un import dynamique reste mémorisé, même après rechargement
  (mesuré), ce qui rendait « Réessayer » inopérant. Seule la scène 3D (PFC-008) est chargée à la
  demande, avec son repli DOM.
- `Stage` : navigation par état (`home`, `setup`, `rules`, `settings`, `arena`), raccourcis contextuels
  (Espace, Échap) et focus. Les raccourcis ignorent `repeat`, les modificateurs et les champs, et laissent
  l'Espace natif d'un bouton ciblé. Chaque écran focalise son titre ; fermer un écran rend le focus au
  bouton qui l'a ouvert.
- Présentation téléphone quand la scène fait moins de 720 px (`useCompact`, seuil de la maquette).
- État :
  - `state/game.ts` : reducer pur de la saisie de X, de la partie et de la session ; il ignore toute
    modification de X pendant une partie ;
  - `state/preferences.ts` : préférences de l'appareil dans `localStorage` (`elem3nts.prefs.v1`),
    relues champ par champ, sans jamais planter si le stockage est indisponible.
- Touches (`input/keys.ts`) : liaisons en codes physiques (D10). Libellés tirés de la Keyboard Layout
  API, puis appris lors d'une réaffectation, puis repli AZERTY. Espace, Entrée, Tab et Échap sont réservées.
- Contrat de réglages partagé dans le domaine (`src/domain/settings.ts`) : `MatchSettings`,
  `DEFAULT_SETTINGS`, `assertSettings`, `parseTargetInput` (codes d'erreur, textes dans `client/copy.ts`).
- Retours visuels : toasts (`components/Toast.tsx`, région `status`, 4 s, suspendus au survol ou au
  focus, en haut de l'écran), transitions d'écran à `fill-mode: backwards` (aucun effet résiduel sur le
  rendu final), et « Mouvements réduits » (`data-reduced-motion` sur `html`) en plus de la préférence système.

### Clavier partagé et choix masqués (PFC-005, 2026-09-28)
- Domaine : `lockChoice` (`src/domain/selection.ts`). Premier choix verrouillé ; un second est un no-op.
  Même règle attendue côté serveur (PFC-014).
- Phases du reducer local :
  - `intro` : bannière de 1,8 s ;
  - `selecting` : 0,4 s plus tard, deux échéances planifiées ensemble comme dans la maquette ;
  - l'action `choose` n'agit qu'en `selecting`.
- `input/useLocalKeys.ts` : écoute `keydown` installée pendant l'arène sur bureau. Elle lit un indicateur
  (`accepting`) mis à jour de façon synchrone à l'échéance : aucune frappe perdue ou anticipée en attendant
  un rendu. Elle ignore :
  - `repeat` ;
  - les modificateurs ;
  - les champs éditables.
  `preventDefault` n'est appelé que si la touche est liée. Une lettre agit même si un bouton a le focus.
- Le choix vit dans le reducer et n'est jamais rendu : le HUD n'affiche que « Choix en cours… » ou
  « Choix verrouillé » (région `aria-live` par joueur).
- Libellés des touches :
  - la Keyboard Layout API, si elle fournit les lettres. Une table vide (Chromium sans session graphique)
    compte comme indisponible ;
  - sinon, un libellé appris de toute frappe de jeu ;
  - sinon, la disposition choisie (AZERTY par défaut, QWERTY). Le choix n'est proposé qu'en l'absence d'API.

### Cycle local (PFC-006, 2026-09-28)
- `state/game.ts` : phases `intro`, `ready`, `selecting`, `reveal`, `result`, `sudden`, `pause`, `closing`
  et `ended`, chacune avec une échéance absolue (`CYCLE_MS`, D09). Horloge injectée (`state/clock.ts`) :
  les actions `start` et `tick` portent `now` ; le reducer reste pur et déterministe.
- `state/useCycle.ts` : une minuterie vers la prochaine échéance, posée dans le commit du rendu, réarmée si
  elle arrive en avance, nettoyée au démontage. `visibilitychange` déclenche un `tick`.
- `playRound` à l'échéance de la sélection (résolution unique) ; `settleMatch` à l'entrée en `ended`
  (trophée unique par matchId).
- Rendu :
  - `screens/Arena.tsx` : statuts, scores, deltas, bannières et annonce unique pour lecteurs d'écran ;
  - `screens/RoundTimer.tsx` : anneau et chiffre de la maquette, mis à jour toutes les 50 ms dans le DOM,
    sans rendu React par pas ;
  - `screens/EndScreen.tsx` : écran de fin de la maquette.

### Revanche et session locale (PFC-007, 2026-09-28)
- Actions du reducer :
  - `rematch {now}` : seulement en `ended`, réglages de la partie terminée, nouveau matchId ;
  - `new-session` : trophées remis à 0/0, refusée pendant une partie.
- `Stage` :
  - « Jouer en local » depuis l'accueil déclenche `new-session` ;
  - « Rejouer » et Espace (hors bouton ciblé, `repeat` ignoré) déclenchent `rematch` ;
  - Échap après la fin revient à l'accueil sans annulation.
- `screens/EndScreen.tsx` : trophées de la session (`session.trophies`) et gains de la partie (`trophiesWon`).

### Client : scène 3D (PFC-008, D33)
- `scene/engine.js` : moteur de la maquette, **généré** par `npm run port:engine` (`scripts/port-engine.ts`,
  correctifs listés en en-tête) ; ne jamais l'éditer à la main. `engine.d.ts` en type l'API publique.
- `scene/useSceneHost.ts` : une seule instance par montage d'`App`, sur le canvas plein écran (premier enfant
  de la scène, `aria-hidden`). Sonde WebGL2, import dynamique (chunk `engine-*.js`, three inclus), délai de 8 s,
  perte de contexte, chien de garde de fréquence d'images ; toute défaillance détruit le moteur et publie
  `fallback` avec sa cause. L'écran d'ouverture attend la fin du chargement (prêt ou repli).
- `scene/sceneContext.ts` : état publié (`loading | ready | fallback`, cause, moteur, positions projetées des
  trois éléments pour les étiquettes de l'arène).
- `scene/commands.ts` : `sceneCommands(avant, après)` pur, de l'état public vers les appels moteur (mapping de
  la maquette) ; `useSceneBridge` les applique dans le rendu. Les rappels d'impact et de fin du moteur ne sont
  pas utilisés : le reducer porte les échéances (phase `clash`, `CLASH_TIMING`, D09).
- `Stage` annonce un repli par un toast unique (cause en clair) ; le jeu reste entièrement dans le DOM.

### Démo des confrontations (PFC-026, D49)
- `state/demo.ts` : reducer pur (`idle → armed → reveal → clash → result → idle`), échéances de la partie
  (`revealDelay`, `clashDelays`, D09) plus 0,7 s de verrous (`DEMO_ARM_MS`). La résolution vient de
  `resolveRound` au lancement ; aucune session, aucun trophée, aucune manche suivante. Un lancement hors repos
  est ignoré (garde du reducer).
- `demoSceneView` projette l'état dans le vocabulaire de `sceneCommands` (écran `demo` : scène d'arène remise
  au repos à l'entrée ; verrous comme une sélection ; repos après une confrontation comme l'après-manche).
- `screens/DemoScreen.tsx` possède son reducer, son horloge (`useCycle`, jamais en tour par tour) et son pont
  de scène, comme `OnlineScreen` : `Stage` retire le sien tant que la démo est affichée (un seul pont actif).
  L'arène commune (`ArenaFrame`, sans « Quitter ») affiche le modèle ; Échap et « Accueil » rendent le focus
  au bouton de l'accueil.

### Contrat réseau v1 (PFC-010, D34)
- `src/shared/protocol/` : types, validation runtime, politique et projection du protocole, partagés par le
  client en ligne et le Worker. Pur comme le domaine, qu'il est seul à importer : projet TypeScript
  `tsconfig.shared.json` (ES2023 sans DOM, `types: []`), règles ESLint `src/shared/**` (ni UI, ni runtime,
  ni client/worker, ni `Date`, `Math.random`, `crypto`…), tests dans le projet Vitest `protocol` (Node).
- Entrée `unknown`, sortie en union discriminée :
  - `parseClientMessage(raw)` : ne lève jamais, rend une commande neuve et gelée ou un refus
    `{code, reason, requestId?}` ;
  - `authorizeCommand(command, room, slot)` : contexte autorisé (tableau de PROTOCOL), sans effet ;
  - `parseServerMessage(raw)` : validation côté client.
- `projectState(room, slot, serverNow)` : allowlist champ par champ depuis `RoomView` ; les choix privés ne
  sont lus que par `lockedPlayers`, les éléments révélés seulement depuis `lastRound` de la manche courante
  en phase révélée. Constructeurs `ackMessage`, `errorMessage` (message fixe), `pongMessage`,
  `roomClosedMessage` : aucun ne reçoit de contenu de commande.
- Le stockage (PFC-011) peut porter plus que `RoomView` (hashes, cache d'idempotence) : il est passé tel quel
  à la projection, qui n'en recopie rien.

### Worker et stockage des rooms (PFC-011, D35)
- `wrangler.jsonc` : entrée `src/worker/index.ts`, Static Assets en mode SPA avec `run_worker_first` = `/api`, `/api/*` ;
  liaison `ROOMS` → classe `Room`, migration initiale `v1` (`new_sqlite_classes`). Migrations append-only. Ni variable
  ni secret (`.dev.vars*`, `.env*`, `.wrangler/` ignorés). `compatibility_date` ≤ date du workerd fourni (test).
- `@cloudflare/vite-plugin` : `npm run dev` et `vite preview` exécutent le Worker dans workerd sur l'origine du front ;
  `vite build` produit `dist/client` et `dist/elem3nts` (bundle + config générée), que `wrangler deploy --dry-run` valide.
- `src/worker/` :
  - `index.ts` : routeur sans état global ; toute route `/api` inconnue, toute méthode → JSON 404 ; exception → JSON 500 ;
  - `http.ts` : erreurs `{ error: { code, message } }` à message fixe, `no-store`, `nosniff` (PROTOCOL « Erreurs HTTP ») ;
  - `codec.ts` : `PersistedRoom` (v1 = `RoomView`) et sa garde complète, réutilisant les validateurs de `src/shared/protocol` ;
  - `storage.ts` : `RoomStore`, une ligne `room_state` (`schema_version`, `revision`, `state` JSON) par objet, API SQLite
    synchrone. `save(next, expectedRevision)` vérifie la révision persistée et écrit dans une seule `transactionSync` ;
    révision strictement croissante ; état hors schéma jamais écrit. `load()` migre (`MIGRATIONS[n]`) puis valide ;
  - `room.ts` : `Room` relit l'état dans son constructeur (réveil, éviction, redéploiement) ; `commit` persiste puis
    remplace la copie en mémoire (point de linéarisation). État illisible ou schéma plus récent : échec fermé, la room
    répond `ROOM_UNAVAILABLE` (503) sans rien relire ni réécrire.
- ESLint `src/worker/**` : ni `let`/`var` de module (aucune autorité globale), ni UI ni API Node, ni `console` ; seule
  exception, `console.log` dans `log.ts`, le journal structuré (PFC-020).

### Rooms privées : création et réservation (PFC-012, D36)
- `entry.ts` : `createRoom` tire code et token, hache le token (`tokens.ts`, Web Crypto) et appelle `create` sur le
  Durable Object nommé par le code (5 tentatives) ; `joinRoom` normalise le code puis appelle `join`. Seul
  le hash traverse le RPC ; les issues sont des valeurs (`created`/`collision`, `reserved`/`full`/`absent`/`unavailable`).
- `reservations.ts` : règles pures (`openRoom`, `reserveGuest`, `settleReservations`, `nextReservationDeadline`),
  sans horloge ni stockage. `room.ts` fournit `now()`, traite les échéances dues puis décide et `commit` sans `await`
  intermédiaire ; ensuite seulement : alarme replanifiée (plus proche réservation) ou room effacée (`deleteAll`).
- `codec.ts` : schéma v2 = `RoomView` + `createdAt` + `seats` (`{ tokenHash, reservedUntil }` ou `null`) et ses
  invariants ; `storage.ts` : migration v1 → v2 et création paresseuse de la table (un code inconnu n'alloue rien).
- PFC-013 authentifie en comparant l'empreinte du token reçu à `seats[slot].tokenHash` (comparaison à temps constant),
  puis passe `reservedUntil` à `null` et `connected[slot]` à vrai dans la même transition.

### WebSocket authentifié (PFC-013, D37)
- `entry.ts` : `connectRoom` filtre `GET /api/rooms/:code/ws` (méthode, upgrade, Origin = origine de la requête, code)
  puis transmet la requête au `fetch` du Durable Object ; aucune room n'est atteinte avant.
- `room.ts` : socket standard acceptée (`accept()`), suivie dans `#links` (identité, budget, file de trames) jusqu'à son
  événement `close`. Cycle `pending → player → retired` (`sockets.ts`) : au plus une socket `player` par place.
  L'alarme unique porte aussi l'échéance d'authentification des sockets `pending`. Toute écriture passe par `commit`
  puis seulement la publication (`#publish` : `projectState` par place, aux seules sockets `player`).
- `seats.ts` : règles pures `findSeat` (comparaison à temps constant, `crypto.subtle.timingSafeEqual`, des deux places),
  `claimSeat` (première connexion faite et présence, `null` si inchangé), `leaveSeat`.
- `sockets.ts` : type `Connection` et budget par connexion (seau de jetons, dépassements consécutifs).
- Frontière avec PFC-014 : `#dispatch` applique `authorizeCommand` ; les commandes de jeu passent par `#play` (ci-dessous).

### Machine de jeu serveur (PFC-014, D38)
- `src/shared/cycle.ts` : chronologie D09 (`CYCLE_MS`, `CLASH_TIMING`, `clashDelays`, `MATCH_INTRO_MS`, `roundFollowUp`,
  `roundResultMs`), seule source des échéances du cycle local (`client/state/game.ts` la réexporte) et de la room.
- `src/worker/game.ts` : règles pures, sans horloge ni stockage. Commandes : `applyCommand` (réglages, prêts, revanche,
  choix) et `closeRoom`. Échéance due : `advanceGame` (une transition). Dédoublonnage : `findReply`/`withReply`.
  Alarme : `nextGameDeadline`. Le moteur du domaine fait tout le calcul (`startMatch`, `lockChoice`, `playRound`,
  `settleMatch`).
- `room.ts` :
  - `#settle` applique réservations puis échéance de jeu, avant toute commande et dans l'alarme ;
  - `#play` rejoue un doublon, sinon applique la garde puis `commit` (réponse mémorisée dans la même écriture) → `#publish` → `ack` ;
  - `#close` (leave) persiste `closed`, publie `room-closed`, ferme, puis la room est effacée ;
  - l'alarme unique couvre aussi `deadline` des phases `starting`, `selecting` et `round-result`.
- `codec.ts` schéma v3 : `settledMatchId` et `replies` (128 par place), invariants phase/partie (partie en cours et
  deadline en jeu, résultat de la manche courante, fin réglée sans deadline) ; migration v2 → v3 dans `storage.ts`.
- `seats.ts` : `leaveSeat` retire aussi la confirmation de la place au lobby et en fin de partie.

### Client en ligne (PFC-015, D39)
- `src/client/online/` : `api.ts` (entrée HTTP, réponse validée par `parseRoomEntry`, échecs typés, délai 10 s),
  `connection.ts` (`RoomConnection` : socket de même origine, `authenticate` en première trame, trames validées par
  `parseServerMessage`, révisions anciennes ignorées, fin unique `EndReason`), `invite.ts` (code 4·4, lien, saisie),
  `clipboard.ts`, `messages.ts` (textes), `useOnlineRoom.ts` (parcours, garde synchrone contre le double clic,
  réglages de l'hôte sérialisés, confirmation). La vérité courante vit dans une ref mise à jour de façon synchrone :
  deux trames reçues avant un rendu ne lisent jamais un état périmé.
- `screens/OnlineScreen.tsx` et `screens/online/` : vues de la maquette (menu, saisie, hôte, connexion) et lobby,
  puis arène et fin de partie (PFC-016) ; Espace confirme (lobby, revanche) sauf contrôle ciblé (`ownsKey`), Échap
  revient en arrière ou quitte la room.
- `Stage` : écran `online`, lien `/p/CODE` lu au chargement ; pendant cet écran, le pont de scène est celui du mode
  en ligne (un seul pont actif).

### Partie en ligne (PFC-016, D40)
- `online/game.ts` (pur) : point de vue (`fromMySide`, « Vous » à gauche), chronologie d'un `state` sur l'horloge
  locale (`timelineOf`, `phaseAt`), modèle d'arène (`onlineArenaModel`), fin (`verdictOf`, `trophiesWonOf`) et
  projection pour la scène (`onlineSceneView`). Aucune règle de manche : scores et résultats viennent du serveur.
- `online/serverClock.ts` : décalage monotone ; `connection.ts` le nourrit (`state`, `pong`) et mesure la latence.
- `online/useTimelinePhase.ts` : moment affiché, un rendu par changement de moment (`useSyncExternalStore`).
- `screens/ArenaFrame.tsx` + `arenaModel.ts` : arène commune au local (`Arena.tsx`) et au en ligne
  (`screens/online/OnlineArena.tsx`) ; `EndScreen` commun (verdict, noms et revanche paramétrés) ;
  `screens/online/SettingsPanel.tsx` : réglages de l'hôte au lobby et avant la revanche.

### Déconnexion, pause et reprise (PFC-017, D42)
- `seats.ts` : `leaveSeat` (absence : délai de reconnexion fixé une fois, pause d'une phase chronométrée avec son
  reste) et `claimSeat` (retour : reprise de la phase quand plus personne n'est absent). `game.ts` : `closeRoom`
  (champs de reprise effacés) ; le délai échu relève de `expiry.ts` depuis PFC-018.
- `room.ts` : `#settle` = réservations → délai échu (`#terminate` : `closed`, `room-closed {reconnect-timeout}`, 4404)
  → échéance de jeu → **réconciliation de la présence** (place persistée présente sans socket `player` vivante dans
  l'instance → absente). `#disconnect` ne fait que retirer la socket puis passer par `#settle` : une seule règle pour
  la fermeture, la socket fermée par le serveur et l'instance perdue.
- `codec.ts` v4 : `reconnectDeadline`, `resumeRemainingMs` et leurs invariants (absence ⇔ délai ; pause ⇔ reste ; en
  pause, `deadline` = délai) ; `storage.ts` : migration v3 → v4.
- Client : `online/session.ts` (place de l'onglet en `sessionStorage`) ; `RoomConnection` (reprise bornée, lien mort,
  `retryNow`, événement `link`) ; `useOnlineRoom` (option `resume`, état `link`, `retry`) ; `Stage` reprend la place
  gardée au chargement ; `screens/online/ConnectionLost.tsx` : écran « Connexion interrompue » de la maquette.

### Expiration et fin de vie (PFC-018, D43)
- `expiry.ts` (pur) : `dueClosure` (reconnexion, durée maximale, inactivité : motif de la plus ancienne échue),
  `nextClosureDeadline` (pour l'alarme), `recordActivity` (monotone). Appelée par `applyCommand` (commande acceptée
  qui modifie la room) et `claimSeat` (première connexion seulement) ; `openRoom` date la création.
- `room.ts` : `#settle` = réservations → `dueClosure` (`#terminate` avec son motif) → échéance de jeu → présence ;
  `#scheduleAlarm` = min(réservation, fin de vie, jeu, authentification) : toute room ouverte a une alarme.
  `nextGameDeadline` ne couvre plus que la phase chronométrée.
- `codec.ts` v5 : `lastActivityAt` (≥ `createdAt`) ; `storage.ts` : migration v4 → v5.
- Client : `online/messages.ts` (`isLastingEnd`), notification persistante (`ToastOptions.persistent`).

### Abus et observabilité (PFC-020, D45)
- `rate.ts` (pur) : `admit`/`prune` (fenêtre glissante exacte, refus non comptés), `clientKey` (`CF-Connecting-IP`,
  IPv6 /64, `unknown` si illisible), `BUCKET_LIMITS` (`entry`, `socket`).
- `limiter.ts` : Durable Object `Limiter` (SQLite, liaison `LIMITER`, migration `v2`), un par clé d'IP ; `take(bucket)`
  lit, décide et écrit (`ctx.storage.kv`, synchrone) sans `await`, puis replanifie une alarme qui efface tout le
  stockage une fois la fenêtre vide. Aucun compteur en mémoire du Worker.
- `entry.ts` : `guardEntry` (create/join : Fetch Metadata puis budget `entry`), `connectRoom` (budget `socket` après
  les gardes PFC-013) ; `rateLimit` → `429` + `Retry-After`, limiteur injoignable → requête admise, panne journalisée.
- `room.ts` : `#makeRoomForPending` (plafond `MAX_PENDING_SOCKETS`, plus ancienne fermée en 4408) ; `#log` ajoute à
  chaque événement l'identifiant du Durable Object, la phase, la partie, la manche et la révision courantes.
- `log.ts` : `logEvent`/`logRecord` (union fermée d'événements, allowlist de champs vérifiée à la compilation),
  `errorName` (nom seul). `http.ts` : en-têtes de sécurité de toute réponse JSON ; `public/_headers` : ceux des pages.
- `wrangler.jsonc` : `observability.enabled` (Workers Logs, échantillonnage 1). Exploitation : `docs/RUNBOOK.md`.

## Rendu et qualité
Le score, les commandes et les messages restent dans le DOM accessible. Effets distincts pour
feu/feu, eau/eau et plante/plante ; mouvements réduits : le moteur de la maquette atténue (particules ×0,45, temps de
scène ×0,55, ni parallaxe ni secousse) et l'interface coupe animations et transitions (D46).
Charger la scène paresseusement ; caper le DPR, borner les particules, suspendre les frames
quand l'onglet est caché sans suspendre le jeu serveur, libérer géométries/matériaux/listeners.
Pas de setState React à chaque frame. Noter machine et navigateur lors des mesures de performance.

| Mesure (date, machine, navigateur) | Résultat |
| --- | --- |
| PFC-008 (2026-09-28, i5-1155G7, WSL2 sans GPU, Chromium headless SwiftShader, 1280×800) | ~1 131 ms par image en haute, ~521 ms en basse : repli « trop lent » |
| PFC-021 (2026-09-29, i5-1155G7, Intel Iris Xe via D3D12/WSLg, Chromium 153 avec fenêtre, `npm run measure:scene`, deux passages) | médiane 16,7 ms (60 i/s, vsync) en basse, moyenne et haute, repos et chorégraphies, 1280×800 et 390×844 @3x émulé ; p95 16,8–33,5 ms ; pics 0,2–1 s aux changements de qualité ; éclairs ≤ 1/s, variation ≤ 0,037 |
| PFC-021, 20 revanches (Chromium SwiftShader, `performance.spec.ts` : basse qualité 800×450 ; mesure isolée en haute 1280×800) | tampons 312, textures 14, cibles constants ; programmes recompilés une fois à la 6e partie (54 → 65 ; 65 → 90 en haute) puis plateau ; 174 écouteurs, 175 nœuds constants ; tas +0,08 Mo (+0,02 en haute) de la 10e à la 20e |
| PFC-021, bundles (gzip -9) | principal 98 ko (React DOM ≈ 2/3), moteur 140 ko (541 ko bruts), CSS 9 ko |
| PFC-021, ouverture (`npm run measure:load`, RTT 150 ms, 1,6 Mbit/s, CPU ×4, 9 passages) | froid : moteur 2,3 → 5,7 s, accueil 9,5 s ; visite suivante 5,4 s → **4,5 s** avec le cache `immutable` de `/assets/*` (0 revalidation) |
| Téléphone réel (iPhone, iOS 26.6.2, Apple GPU, WebKit (app Google), 428×745 @3x, 2026-09-29, sonde `?perf`) | médiane 17 ms (60 i/s) à toutes qualités, repos et effets ; p95 17–18 ms ; max 20–126 ms ; éclairs 0/s, variation ≤ 0,024 |

Chien de garde (D33) conservé à 150 ms : ≈ 9× le temps d'image GPU mesuré, sous le meilleur rendu logiciel (521 ms).
Goulot de l'ouverture à froid : la compilation synchrone des programmes au premier rendu (`getUniforms` de three.js,
≈ 2,7 s sous CPU ×4, profil CDP) ; compilation asynchrone proposée en PFC-027.
