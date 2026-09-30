# Vérification et Definition of Done

## Contrat des scripts à créer
| Commande | Contrat |
| --- | --- |
| npm ci | Installation reproductible via lockfile versionné |
| npm run dev | Front + Worker local, API et sockets de même origine via proxy |
| npm run build | Typecheck client/partagé/Worker puis bundle production front et validation bundle Worker sans publier |
| npm run test:functional | Vitest en mode run : domaine, composants/contrôleurs et intégration Worker ; aucun watch |
| npm run lint | ESLint, zéro warning, sans réécriture automatique |
| npm run test:e2e | Playwright Microsoft, Chromium/Firefox/WebKit, contre build + Worker local réel |
| npm run verify | build → test:functional → lint → test:e2e, arrêt au premier échec |
| npm run deploy:staging | Déploiement explicite de l'artefact vérifié sur environnement staging |
| npm run deploy:production | Déploiement explicite de l'artefact vérifié sur production |

PFC-001 crée les commandes honnêtes pour le socle présent. Ajouter les suites avec leurs tickets ;
aucune commande no-op ni `passWithNoTests` pour donner l'apparence d'un gate réussi.

### Commandes réellement disponibles (depuis PFC-001)
| Commande | Couverture actuelle | Écart avec le contrat, ticket qui le comble |
| --- | --- | --- |
| npm ci | Lockfile versionné, versions exactes, Node vérifié par `engine-strict` | — |
| npm run dev | Front Vite et Worker local (workerd, plugin `@cloudflare/vite-plugin`) sur la même origine, port 5173 ; API et WebSocket de room (`/api/rooms/:code/ws`, depuis PFC-013) | — |
| npm run build | `tsc -b` (domaine, partagé, Worker, client, tests, configs/scripts/E2E), `vite build` (client dans `dist/client`, Worker dans `dist/elem3nts`), puis `wrangler deploy --dry-run` (bundle, liaisons et migration validés, rien publié) | — |
| npm run test:functional | `vitest run`, quatre projets. `domain` : Node pur, `tests/unit/domain`. `protocol` : Node pur, contrat réseau `tests/unit/protocol` (depuis PFC-010). `client` : jsdom, composants `tests/unit` et garde-fous d'outillage `tests/tooling`. `worker` (depuis PFC-011) : Node, `tests/integration`, runtime Workers local réel (depuis PFC-013 : vraies sockets réseau, en-tête `Origin` compris ; depuis PFC-014 : machine de jeu, horloge figée, alarmes exécutées à la main, panne de stockage simulée par le harnais) | — |
| npm run lint | `eslint . --max-warnings=0` : typescript-eslint strict typé, React Hooks, jsx-a11y (fork `-x`) | — |
| npm run test:e2e | Playwright Chromium/Firefox/WebKit contre `npm run build && npm run preview` (port 4173) : build servi par le Worker local réel (workerd) | — |
| npm run verify | build → test:functional → lint → test:e2e, arrêt au premier échec | — |
| npm run baseline:mockup | Outil hors gate : recapture les références visuelles depuis la maquette (réseau requis) | — |
| npm run port:engine | Outil hors gate : régénère `src/client/scene/engine.js` depuis la maquette (D33) ; un test de dérive échoue si le fichier diffère | — |
| npm run measure:scene | Outil hors gate (PFC-021, D46) : temps d'image et éclairs de la vraie scène sur le GPU du poste (Chromium avec fenêtre, serveur de développement lancé par le script, sonde `?perf`) | — |
| npm run measure:load | Outil hors gate (PFC-021, D46) : ouverture à froid et visite suivante sous profil mobile Lighthouse, contre `npm run preview` déjà lancé ; `RUNS=9` pour plus de passages | — |
| npm run deploy:staging | `node scripts/deploy.ts staging` (PFC-022) : publie `dist/` **déjà vérifié** sans rebuild ; refuse un artefact non construit avec `CLOUDFLARE_ENV=staging` ; version étiquetée par le commit ; accès `wrangler login` ou `CLOUDFLARE_API_TOKEN` | — |
| npm run deploy:production | `node scripts/deploy.ts production` : même garde, artefact construit sans `CLOUDFLARE_ENV`, arbre git non modifié exigé ; jamais lancé par la CI ; cible https://elem3nts.bluestarz.workers.dev (PFC-023, D50) | — |
| npm run test:smoke | Hors gate (PFC-022, PFC-023) : Playwright Chromium contre un Worker déployé (`SMOKE_URL`, HTTPS exigé hors machine locale), `tests/smoke/deployed.spec.ts` : en ligne, deux clients (lien d'invitation, WSS, reprise après rechargement, fin de partie, trophée, revanche) ; en local, clavier partagé avec la vraie scène (victoire, trophée, revanche) ; en-têtes, API JSON 404, fichiers à empreinte ; échoue sans `SMOKE_URL` | — |

Prérequis E2E sur une machine neuve : `npx playwright install chromium firefox webkit`, puis
`sudo npx playwright install-deps chromium firefox webkit` (dépendances système Linux/WSL).

### Parité visuelle avec la maquette
`tests/e2e/visual.spec.ts` (projet Chromium uniquement) compare l'application aux références
de `tests/e2e/__screenshots__/`, capturées **depuis la maquette** par `npm run baseline:mockup`.
Les références se recapturent seulement quand la maquette change, jamais pour faire passer
le test après une modification de l'application. La tolérance est nulle (`threshold: 0`, `maxDiffPixels: 0`). Avant
chaque capture, attendre les polices (`document.fonts.load`) et la fin réelle des animations
(`waitForVisualStability`) : sans cela, 2 captures sur 20 ont été prises à opacité 0.

Depuis PFC-004, 16 références (écran d'ouverture, accueil, préparation X=3 et X=10, règles,
réglages avec et sans nul, ouverture de l'arène ; 1280×800 et 390×844) :
- **Moteur 3D bouchonné** dans la maquette (méthodes vides) : les panneaux DOM sont comparés sans la
  scène (PFC-008).
- **Même parcours** des deux côtés : `SCREEN_STATES` (`tests/e2e/support.ts`), par noms accessibles.
- **Horloge figée** (`freezeClock` : `clock.install` puis `pauseAt`). `install` seul laisse le temps
  s'écouler. L'écran d'ouverture est maintenu en ne franchissant pas sa durée minimale (`holdSplash`) ;
  les écrans sont atteints en avançant l'horloge de 600 ms (`openFrozen`).
- **Raster Chromium déterministe** (`DETERMINISTIC_CHROMIUM_ARGS`, projet Chromium et script de
  capture). Sans ces options, les coins arrondis sous `backdrop-filter` variaient d'une capture à l'autre
  (3 rendus distincts sur 6).
- **Clavier AZERTY émulé** (Keyboard Layout API bouchonnée dans le test) : la maquette affiche Q/S/D.
  C'est l'environnement qui est simulé, l'application n'expose aucune fixture.
Retenir une police pour maintenir l'écran d'ouverture ne fonctionne pas : `toHaveScreenshot` attend
toutes les polices.
Depuis PFC-005 (19 références) :
- 3 états de sélection sur bureau : `select-start`, `select-p1-locked`, `select-both-locked`.
- Frappes AZERTY simulées par `pressAzerty` (même `KeyboardEvent` pour les deux : la maquette lit le
  caractère, l'application le code physique).
- **Masque** (`ScreenState.mask`) : une zone encore absente de l'application (minuteur, PFC-006) est
  masquée à l'identique des deux côtés (même boîte, même couleur) ; tout le reste est comparé à tolérance
  nulle. Un masque se retire dès que l'élément est livré.
Depuis PFC-006 (26 références, plus aucun masque) :
- États du cycle : `select-late`, `reveal`, `result`, `result-solo`, `result-void`, `sudden`, `end`.
- Le moteur bouchonné de la maquette appelle aussitôt les rappels de `clash` (impact, puis fin) ;
  depuis PFC-008, il les appelle aux échéances du vrai moteur (`CLASH_TIMING`).
- **Avancer l'horloge phase par phase et attendre le rendu de chaque phase** avant l'avance suivante.
  L'application pose chaque échéance dans le rendu de sa phase ; avancer plus loin d'un coup ne
  déclencherait pas l'échéance suivante. Depuis PFC-008, les pas suivent la chronologie D09
  (`tests/e2e/timing.ts`, dont un test unitaire vérifie la synchronisation avec `state/game.ts`).
Depuis PFC-007 : **zone fixe** (`ScreenState.zone`) pour un ajout sans équivalent dans la maquette (trophées
de fin, D32). Un calque posé aux mêmes coordonnées est masqué des deux côtés ; le test échoue si l'ajout déborde
de la zone (marge de 2 px). Tout le reste de l'écran reste comparé à tolérance nulle.
Depuis PFC-008 (scène 3D, D33) :
- **Parité d'interface** : le moteur reste bouchonné des deux côtés (route `**/assets/engine-*.js` dans
  l'application). Le rendu logiciel mesuré (~1 frame/s sans GPU) ferait basculer l'application vers le
  repli « trop lent » et rendrait le parcours non reproductible.
- **Parité 3D** (`tests/e2e/scene.spec.ts`, Chromium) : accueil comparé à une capture de la maquette,
  canvas visible et interface masquée (`hideInterface`), aléa réinitialisé à la création du contexte WebGL.
  La maquette ne se rend pas deux fois à l'identique (3 variantes sur 4 captures, jusqu'à 3,9 % de pixels,
  au plus 0,013 % au-delà de 25 niveaux) : tolérance `SCENE_TOLERANCE` (seuil 0,1, 0,05 % de pixels).
- **Effets** : feu+feu, eau+eau et plante+plante capturés à l'impact, distincts deux à deux (écarts forts).
- **Mouvements réduits** : même impact feu+feu avec et sans `prefers-reduced-motion` ; 4,46 % d'écarts forts
  mesurés, 0 % quand le pont ne transmet plus la préférence (mutation) ; seuil 1 %.
- **Robustesse** (Chromium) : WebGL2 absent (3 navigateurs), perte de contexte, onglet masqué sans rendu,
  un seul contexte et une seule boucle d'animation après plusieurs revanches.
Depuis PFC-009 (recette locale, `tests/e2e/local.spec.ts`, 3 navigateurs) :
- **Parcours enchaînés au clavier seul** : accueil → Espace → X par Début/Fin du champ → Réglages (nul OFF)
  → Espace → choix → révélation → victoire → revanche à l'Espace, focus vérifié à chaque écran (titre de
  préparation, retour du tiroir, arène, fin, Rejouer, Retour à l'accueil). Bornes X = 1 et X = 10 jouées
  (exemple chiffré SPEC 9/9 → 10/10 → mort subite → 11/10), mort subite sans trophée puis un seul trophée,
  frappe après la fenêtre de choix ignorée. Victoire et nul avec nul ON : `rematch.spec.ts`.
- **Pilote partagé** `tests/e2e/local-driver.ts` (`toSelection`, `playRound` : manche suivante, mort subite ou
  fin) : horloge figée avancée phase par phase, même règle que ci-dessus ; utilisé aussi par `rematch.spec.ts`.
- **Garde build de production** (PFC-009-AC3) : pas de client Vite ni de source `/src/`, entrée `/assets/index-<hash>.js`.
  En local, `reuseExistingServer` réutiliserait un `vite preview` déjà lancé sur 4173 avec un `dist/` éventuellement
  périmé : arrêter tout preview avant la recette. Vérifié : la garde échoue contre `vite` (3 navigateurs).
- **Échecs** : ligne `[chromium|firefox|webkit] › fichier › PFC-xxx-Sn — …` (reporter list), dossier
  `test-results/<test>-<navigateur>/` avec `trace.zip` (`npx playwright show-trace …`), capture et `error-context.md`,
  rapport `playwright-report/index.html`. Titres de test préfixés par l'ID ticket et scénario.
- Mutation contrôlée (nul OFF traité comme nul ON dans `src/domain/match.ts`, restaurée) : S2 et X = 10 échouent.
Depuis PFC-011 (Worker local et stockage, D35) :
- **Intégration Worker** (projet Vitest `worker`, Node) : `createTestHarness` de wrangler lance le vrai runtime
  `workerd` sur le Worker de test `tests/integration/harness/wrangler.jsonc` (Worker de production + room dotée
  de deux méthodes RPC, `/__harness/rooms/:name`, jamais déployées). `@cloudflare/vitest-pool-workers` 0.22 exige
  encore Vitest 4 : ne pas rétrograder Vitest, réévaluer quand il accepte Vitest 5.
- **Reconstruction** : `evictDurableObject` détruit l'instance en conservant le stockage ; l'appel suivant relit
  la ligne SQLite dans le constructeur. Garder les stubs de Durable Object dans le Worker de test : un stub tenu
  depuis Node empêche l'éviction (« active references »).
- `getDurableObjectStorage(...).exec()` lit ou altère la ligne brute `room_state` (schéma plus récent, JSON illisible,
  révision incohérente) pour prouver l'échec fermé.
- **E2E** : le build est servi par workerd ; `/api` et `/api/*` passent avant les fichiers (`run_worker_first`).
  Avec cette liste, Static Assets applique le repli SPA à tout autre chemin absent, y compris un fichier
  `/assets/*.js` inexistant (mesuré, comportement de Cloudflare) : seul `/api` garantit un 404 JSON.
- Mutations contrôlées (restaurées) : restauration ignorée (constructeur sans lecture) → S1 échoue ; `run_worker_first`
  retiré → S2 échoue en E2E (la page React répond).
Depuis PFC-012 (rooms privées, D36) :
- Le Worker de test ajoute : horloge figée des rooms (`/__harness/clock`, jamais en production), alarme lue ou
  exécutée (`/__harness/rooms/:name/alarm`), création à codes imposés (`/__harness/create`, collisions forcées) et
  rafale de `join` lancée depuis le runtime (`/__harness/rooms/:name/burst`). Les instants figés sont dans le futur
  (2033) : une alarme réelle n'interfère jamais ; un test dédié laisse l'alarme réelle de workerd effacer une room.
- `tables()` ignore `_cf_*` et `__miniflare_do_name` (table que Miniflare crée en local pour `getByName`).
- Mutations contrôlées (restaurées) : minuterie de 1 ms entre décision et `commit` dans `join` → la rafale accorde
  plusieurs J2 (S2 échoue) ; les 12 requêtes HTTP concurrentes, étalées d'environ 12 ms par le hachage côté Worker,
  ne détectent qu'une fenêtre plus large (20 ms), d'où la rafale interne.
Depuis PFC-014 (machine de jeu, D38) :
- Le Worker de test ajoute une panne de stockage simulée (`/__harness/rooms/:name/fail`, PUT `{ commits }` : les
  prochaines écritures de l'instance lèvent sans rien écrire) ; l'alarme exécutée rend `failed` si son traitement lève.
- Sockets standard (D37) : une instance n'est évincée qu'une fois ses sockets fermées ; le test de reconstruction
  ferme donc les deux sockets avant l'éviction, puis exécute l'alarme persistée.
- Mutations contrôlées (restaurées) : échéance traitée sans vérifier qu'elle est due → S1 échoue (et 12 autres) ;
  dédoublonnage retiré → le double submit échoue ; publication avant `commit` à l'échéance → le test de panne
  de stockage échoue.
Depuis PFC-015 (créer, rejoindre, lobby, D39) :
- **E2E multijoueur** `tests/e2e/lobby.spec.ts` (3 navigateurs) : contextes indépendants contre le Worker local réel,
  trames `state` capturées (`page.on('websocket')`) et validées par `parseServerMessage` ; aucune socket simulée.
  Presse-papier : réel sous Chromium (permission accordée), copie observée à l'appel sous Firefox et WebKit ; refus
  simulé pour le repli. Double clic compté sur les requêtes `POST /api/rooms`.
- **Parité** : `online-menu` et `online-join` (1280×800, 390×844). Le champ « Code reçu » est une zone fixe par taille
  d'écran (`zoneRect`) : indication de 8 caractères (D39). Hôte, lobby et « Adversaire trouvé » n'ont pas de parité
  stricte (bouton de prototype retiré, code et nom différents) : revue de captures.
- `npm run baseline:mockup -- --only <préfixe>` ne capture que les états nommés ainsi : ajouter des états ne réécrit
  aucune référence existante.
- **Composants** (`tests/unit/client/OnlineScreen.test.tsx`, `roomConnection.test.ts`, `onlineApi.test.ts`,
  `onlineInvite.test.ts`) : fausse socket pilotée (`onlineFakes.ts`), états construits par `projectState`.
- Mutation contrôlée (restaurée) : garde synchrone de création retirée → le test du double clic échoue.
Depuis PFC-016 (partie en ligne, D40) :
- **E2E multijoueur** `tests/e2e/online.spec.ts` (3 navigateurs, Worker local réel, horloge réelle : fenêtre de 5 s,
  X = 1 pour des parties courtes, délai de test 120 s) : trames brutes des deux sockets dans les deux sens
  (`online-driver.ts`, partagé avec `lobby.spec.ts`) ; aucune trame reçue avant le premier `round-result` ne contient
  d'élément. Attendre des états observables (phase `data-phase`, textes), jamais un délai fixe.
- **Parité** : `online-arena-intro`, `online-select` (bureau et téléphone), `online-select-locked`, `online-result`,
  `online-end`. La maquette atteint l'arène par ses boutons de prototype (adversaire « Sylve », `Math.random` fixé à 0 :
  Feu à 0,7 s) ; l'application par une room simulée (`online-fake.ts` : `page.route` + `page.routeWebSocket`, trames de
  la vraie projection, horloge du serveur = horloge figée de la page + constante). `routeWebSocket` doit être installé
  avant la navigation (mesuré : sinon la socket atteint le vrai Worker). Moteur bouchonné qui situe les trois éléments
  des deux côtés (`TRINITY_POINTS`, états `trinity`) ; zones fixes multiples (`zones`).
Depuis PFC-017 (déconnexion, pause et reprise, D42) :
- **Intégration** `tests/integration/reconnect.test.ts` (runtime Workers local réel, horloge figée, alarmes à la main) :
  chaque absence vient d'une vraie socket fermée ou d'une instance reconstruite sur une présence persistée (jamais
  d'une écriture de présence) ; pause en ouverture, sélection et résultat, reprise au reste exact, échéance à
  29 999 / 30 000 ms, deux absents, lobby et fin de partie, coupure à l'échéance exacte et 1 ms avant, dernier résultat
  (trophée une fois ; délai échu : jamais réglé), ancienne socket 4409. Les tests PFC-012/013 qui simulaient une
  présence par écriture authentifient désormais de vraies sockets. `storage.test.ts` : schéma v4 et migration v3 → v4.
- **Composants** `tests/unit/client/OnlineReconnect.test.tsx` (application complète, StrictMode) et
  `roomConnection.test.ts` (reprise bornée, délais, codes terminaux, lien mort, resynchronisation).
- **E2E** `tests/e2e/reconnect.spec.ts` (3 navigateurs, Worker local réel, horloge réelle) : rechargement pendant la
  sélection, socket coupée par `routeWebSocket` relié au serveur (`connectToServer`), départ définitif et fermeture
  à 30 s.
- **Parité** `online-lost` et `online-lost-retry` (bureau et téléphone, maquette : « Simuler une coupure » puis
  « Réessayer ») ; sous le voile flouté, la zone du nom de l'adversaire est élargie de la portée du flou ; titre et
  sous-titre de l'adversaire absent exclus (D42).
- Mutations contrôlées (restaurées), détectées : délai de reconnexion repoussé à chaque absence ; délais de reprise
  du client modifiés.
Depuis PFC-018 (expiration et fin de vie, D43) :
- **Intégration** `tests/integration/expiry.test.ts` (runtime Workers local réel, horloge figée, alarmes à la main,
  activité uniquement par de vraies commandes) : S1 plus de 150 manches vides jouées une à une jusqu'à l'inactivité,
  S2 pings jusqu'à l'échéance puis ping à l'instant exact, activité qui prolonge ou non, invité tardif, 4 h malgré
  l'activité et pendant une pause, motif de la première échéance, alarmes concurrentes, alarme et commandes au même
  instant, socket non authentifiée, instance perdue ; nettoyage vérifié par tables, alarme, `join` et socket.
  Les tests qui attendaient « aucune alarme » au lobby ou en fin de partie attendent l'échéance d'inactivité ;
  `persisted(room, createdAt)` date les fixtures relues par une vraie room (durée maximale).
- **Composants** `tests/unit/client/OnlineExpiry.test.tsx` ; **E2E** `tests/e2e/expiry.spec.ts` (3 navigateurs, room
  simulée `close(reason)` : message persistant, fermeture au clavier). L'expiration réelle (30 min, 4 h) n'est pas
  attendue en E2E : aucune horloge de test n'existe dans le Worker de production.
- Mutations contrôlées (restaurées), détectées : motif à ordre fixe au lieu de la première échéance ; reprise de place
  comptée comme activité.
- **Composants** `tests/unit/client/OnlineGame.test.tsx` (application complète, horloge factice, fausse socket) et
  `onlineGame.test.ts` (horloge, chronologie, point de vue, scène).
- Mutations contrôlées (restaurées), toutes détectées : révisions anciennes acceptées ; sélection révélée par l'horloge
  locale ; touches de Joueur 2 ; revanche envoyée deux fois ; point de vue ignoré ; décalage d'horloge non monotone.
Depuis PFC-019 (recette réseau et tests adverses, D44) :
- **Intégration** `tests/integration/adversarial.test.ts` (runtime Workers local réel, horloge figée partagée par toutes les
  rooms, alarmes à la main ; pilote partagé `tests/integration/driver.ts`) : S1 deux rooms en parallèle (B décalée de 7,1 s,
  ligne persistée, alarme et trames comparées à chaque point de contrôle, dans les deux sens) ; S2 trames reçues des deux
  clients jusqu'à la revanche (aucun élément avant `revealedChoices`, schéma, aucun token ni empreinte) ; AC2 mauvaise phase
  (13 cas, refus sans écriture, publication ni décalage d'alarme), revanche en double, choix renvoyé après reprise sur une
  nouvelle socket (même `requestId`, même altéré : même `ack`, choix d'origine), réglages périmés, ancienne partie, token
  d'une autre room et troisième `join` en pleine partie, trois alarmes et un choix tardif au même instant, nul ON en ligne
  (un trophée chacun, une fois) ; AC3 `server.getLogs()` sans token ni empreinte sur tout le cycle de vie (partie, revanche,
  reprise, intrusion, panne 1011, fermeture par échéance, départ). Cas déjà prouvés et non recopiés : double submit, alarme
  répétée et reconstruction (`game.test.ts`), 4409 et isolation au lobby (`sockets.test.ts`), alarmes concurrentes de fin
  de vie (`expiry.test.ts`), pause et reprise (`reconnect.test.ts`).
- **E2E** `tests/e2e/network.spec.ts` (3 navigateurs, build de production servi par workerd, horloge réelle) : AC1 un seul
  parcours, deux contextes jusqu'au trophée, troisième contexte refusé en pleine partie (aucune socket ouverte), revanche
  jouée jusqu'au second trophée `[1,1]` ; S2 : dans les trames reçues des deux joueurs et des deux parties, un élément
  n'apparaît que dans `revealedChoices` d'un résultat ou d'une fin, après la publication des deux verrous ; tokens absents
  des trames reçues, des états, de l'URL, du DOM, du localStorage et de la console (le sien seulement sous `elem3nts.room.v1`).
  Le troisième contexte subit en plus le signalement natif du 409 par le navigateur (et, sous Firefox, un avertissement
  WebGL) : seuls le 409 de la jonction, l'absence d'erreur de page et l'absence de socket sont exigés.
- **Aucune route de triche** : `dist/client` et `dist/elem3nts` (cartes de source comprises) ne contiennent aucun marqueur du
  Worker de test (`__harness`, `failCommits`, `runAlarm`, `alarmAt`, `harness/entry`) ; `/api/__harness/*` → 404 JSON,
  `/__harness/*` → repli SPA, jamais une réponse du harnais.
- Mutations contrôlées (restaurées, fichier comparé à sa copie), toutes détectées : sélection courante publiée comme
  `revealedChoices` en sélection (S2 intégration + 2 autres, E2E) ; réponses mémorisées ignorées (2 tests de doublons) ;
  échéance traitée sans vérifier qu'elle est due (18 tests) ; token écrit en console par le Worker (test des journaux) ;
  route `/__harness/clock` ajoutée au Worker de production (garde du build). Mutation équivalente écartée : `isRevealedPhase`
  vrai en sélection ne fuit rien, `projectState` exige aussi `lastRound.roundId === roundId` (défense en profondeur).
- Limites : les journaux vérifiés sont ceux de workerd en local (le Worker n'écrit aucune console) ; les journaux de la
  plateforme Cloudflare relèvent de PFC-020/022. Pas de test de charge (hors périmètre).
Depuis PFC-020 (abus et observabilité, D45) :
- **Adresse cliente** : les limites sont par `CF-Connecting-IP`. Le Worker de test donne une adresse neuve (/64 de
  documentation) à chaque requête transmise au Worker de production, ou celle qu'impose `x-harness-client-ip`
  (`CLIENT_IP_HEADER`, `openSocket(…, clientIp)`) ; la copie transmise n'a pas de corps (l'API n'en lit aucun ; un corps
  transféré puis jamais lu coupait la connexion réutilisée par la requête suivante). En E2E, `isolatedContext` donne à
  chaque contexte son propre /64 et `playwright.config.ts` une adresse par processus aux fixtures par défaut : sans cela,
  toute la recette partagerait le budget de 127.0.0.1. Mesuré : l'en-tête atteint aussi l'upgrade WebSocket dans les
  3 navigateurs (60 ouvertures admises, 61e refusée, autre IP admise).
- **Journaux** : `structuredLogs(server)` relit les événements de `log.ts` dans les journaux de workerd (forme
  `util.inspect` en local) ; Workers Logs indexe les mêmes objets en production.
- **Pures** `tests/integration/rate.test.ts` (Node) : fenêtre glissante (borne exacte à 60 s, refus non comptés,
  `Retry-After`), clé d'IP (IPv4, IPv4 dans IPv6, IPv6 /64 sous toutes ses écritures, entrées illisibles → `unknown`),
  allowlist du journal (champs inconnus, `requestId`, token et charge écartés), `errorName`.
- **Intégration** `tests/integration/abuse.test.ts` (runtime Workers local réel, horloge figée) : S1 10 créations puis
  429 + `Retry-After: 60`, exactement 10 `room.created`, autre IP et /64 voisin admis ; fenêtre glissante (59,999 s /
  60 s) ; budget commun create/join, jonction sur code inconnu comptée ; **quota atomique** (20 créations simultanées →
  10 × 201, 10 × 429, 10 rooms) ; stockage du limiteur effacé par son alarme ; Fetch Metadata (4 cas 403 sans room ni
  budget consommé ; sans en-têtes admis) ; 60 sockets par IP puis 429 avant toute room ; plafond de 2 sockets en attente
  (plus ancienne 4408 sans trame, joueurs intacts) ; S2 trames malformées portant un token (en attente et authentifiée)
  et `requestId` égal au token → `message.rejected INVALID_MESSAGE`, aucun token, empreinte, charge ni code de room dans
  les journaux ; corrélation `room`/`phase`/`match`/`round`/`revision` ; 1011 et alarme en échec : nom d'erreur seul ;
  en-têtes de sécurité des réponses JSON.
- **E2E** `tests/e2e/security.spec.ts` (3 navigateurs, build servi par workerd) : en-têtes de `/`, `/p/:code` (repli
  SPA), d'un fichier du build et de l'icône ; `/_headers` jamais servi ; scène 3D réelle `ready` sous CSP, aucune
  violation (`securitypolicyviolation`) ; lobby réel à deux contextes sous CSP (API et socket), aucune violation ni
  problème ; S1 vu de l'interface (10 créations puis message « Trop de tentatives… », bouton réutilisable, aucune room) ;
  61e socket refusée (1006) quand une autre IP passe ; site tiers (127.0.0.1, page sans notre CSP) qui poste 12 fois :
  requêtes parties, 403 ou bloquées par CORP, budget de la victime intact ; aucun secret ni variable dans `dist/`.
  `network.spec.ts` : `x-harness-client-ip` ajouté aux marqueurs interdits dans le build. Toute la recette tourne
  désormais sous la CSP de production.
- Constat : notre propre CSP (`connect-src 'self'`) bloque d'emblée toute requête d'une page servie par ce Worker vers
  une autre origine ; le test de site tiers sert donc sa page sans elle (`page.route`), comme un vrai site tiers.
- Outillage sous CSP : la CSP de production refuse aussi les injections des tests. `hideInterface` pose une feuille
  construite (`adoptedStyleSheets`) au lieu d'une balise `<style>` ; `strongDiffRatio` compare ses captures (`data:`)
  dans une page vierge du contexte. Jamais `bypassCSP` : la recette doit tourner sous la politique livrée.
- Mutations contrôlées (restaurées, fichier comparé à sa copie), toutes détectées : attente de 5 ms entre décision et
  écriture du limiteur → le test du quota atomique échoue ; origine vérifiée après la limite
  → 4 tests Fetch Metadata (budget consommé) ; allowlist du journal contournée et `requestId` journalisé → allowlist et
  S2 ; plafond des sockets en attente retiré → test du plafond ; limite `socket` retirée → test des 60 ouvertures ;
  `connect-src 'none'` dans `_headers` → 4 tests E2E (en-têtes, lobby sous CSP, S1 à l'écran, sockets).
- Limites : `limiter.unavailable` (limiteur injoignable, requête admise) n'est pas provoqué en test, faute de moyen
  d'isoler une panne de Durable Object dans workerd sans code de test dans le Worker de production ; comportement lu
  à la revue. Pas de test de charge ni de protection volumétrique (règles de zone Cloudflare, `docs/RUNBOOK.md`).
Depuis PFC-021 (accessibilité et performance, D46) :
- **Audit** `tests/e2e/audit.ts` : `expectAccessible` = axe-core (`@axe-core/playwright`, WCAG 2.2 A/AA + bonnes
  pratiques, mode « legacy », horloge figée avancée d'1 ms tant que l'analyse tourne) dans les 3 navigateurs, puis
  contraste **mesuré** sur le rendu Chromium : capture texte masqué (halo conservé), fond réel sous chaque texte, 10e
  centile, seuils 4,5:1 / 3:1. Firefox et WebKit peignent autrement le texte masqué (dégradé `background-clip: text`) :
  mesure non fiable, constatée, donc réservée au rendu de référence. Exemptions nommées uniquement (D46).
- **E2E** `tests/e2e/a11y.spec.ts` (3 navigateurs) : PFC-021-S1 local au clavier seul (chaque contrôle atteint par Tab
  montre un anneau ≥ 2 px, piège du tiroir depuis le titre, focus rendu au déclencheur, verdict décrit, rejouer puis
  accueil) et en ligne à deux contextes sans souris (créer, rejoindre par saisie, X au clavier, prêt, choix, rejouer,
  quitter) ; PFC-021-S2 mouvements réduits (révélation lisible, aucune animation > 1 ms, choix de l'appareil
  prioritaire et mémorisé) ; sans WebGL + mouvements réduits (partie et revanche) ; contrôles tactiles en ligne à
  390×844 et 320×568 (cibles ≥ 44 px, choix au toucher, revanche, aucun défilement horizontal) ; audit de 8 écrans
  locaux (2 tailles) et 8 états en ligne ; reflow 320×568 (WCAG 1.4.10). Firefox sans fenêtre garde le focus sur le
  dernier contrôle quand Tab quitte la page : les parcours détectent « Tab n'a rien déplacé » et reprennent au titre.
- **E2E** `tests/e2e/performance.spec.ts` (Chromium) : 20 revanches avec la vraie scène, en basse qualité et 800×450
  pour borner le rendu logiciel dans le gate parallèle (15 min en 1280×800 haute sous charge, famine des tests à
  échéance réelle constatée ; ≈ 1,5–3 min ainsi) (tampons, textures, cibles de
  rendu constants ; programmes et VAO en plateau entre la 10e et la 20e ; écouteurs et nœuds CDP après ramasse-miettes
  constants ; tas < +2 Mo ; une boucle d'image) ; budgets gzip des bundles et sonde absente du build ; cache
  `immutable` des fichiers à empreinte, page revalidée. Sous horloge figée, le chien de garde (D33) verrait chaque bond
  comme une image : 26 vraies images de 16 ms le laissent conclure avant les bonds (sans cela, repli mesuré au bout
  d'environ 25 bonds).
- **Unitaires** : `focusTrap.test.tsx` (dialogue monté tardivement, Maj+Tab depuis le titre, retrait), préférences
  (système suivie, choix prioritaire, anciens enregistrements), `Stage` (Espace = nouvelle session, retour des
  Réglages, verdict décrit, notification fermée au clavier), `OnlineReconnect` (dialogue de coupure au clavier),
  `OnlineGame` (20 revanches en ligne : ni écouteur ni minuterie en plus).
- **Mesures hors gate** : `npm run measure:scene` (GPU réel ; Chromium sans fenêtre retombe sur SwiftShader sous
  WSL2, mesuré) et `npm run measure:load` (preview lancé). Résultats datés et machine : D46 et ARCHITECTURE « Rendu
  et qualité ».
- **Téléphone réel** (sonde de développement, jamais livrée) : `npm run dev -- --host`, ouvrir sur le téléphone
  `http://<adresse-du-poste>:5173/?perf`, ne plus toucher l'écran ~1 min, puis recopier le panneau (texte
  sélectionnable ; le presse-papier exige HTTPS). Sous WSL2, exposer le port côté Windows (réseau « mirrored », ou
  `netsh interface portproxy add v4tov4 listenport=5173 connectaddress=<ip WSL> connectport=5173` et règle de
  pare-feu), même Wi-Fi.
- Mutations contrôlées (restaurées, fichier comparé), toutes détectées : `--focus-ring: none` → S1 (anneau) ;
  `--color-ink-muted` assombri → audit (contraste) ; `Espace` de l'accueil sans nouvelle session → test `Stage` ;
  piège sans dépendance d'ouverture → `focusTrap` et `OnlineReconnect` ; garde du dialogue retirée → `OnlineReconnect` ;
  préférence toujours enregistrée → préférences ; écouteur `visibilitychange` jamais retiré → 20 revanches en ligne.
Depuis PFC-025 (tour par tour sur un seul téléphone, D47) :
- **Unitaires** : `game.test.ts` (voile sans échéance, seul le joueur du tour choisit, choix de J1 → voile de J2, choix
  ou échéance de J2 → révélation unique, S1, S2 R11, manche vide, « prêt » répété, mode fixé à l'ouverture de la
  manche dans les deux sens de redimensionnement) ; `Stage.test.tsx` (voile focalisé, clavier sans effet, choix au
  toucher, aucune trace du choix de J1 dans le DOM avant la révélation, révélation au choix de J2).
- **E2E** `tests/e2e/turns.spec.ts` (3 navigateurs, écran tactile 390×844, horloge figée) : S1/AC1–AC2, S2, J2 hors
  délai, AC3 bureau ↔ téléphone ; `keyboard.spec.ts` : redimensionnement avant l'ouverture de la manche.
- **Parité visuelle** (maquette, tolérance nulle) : états `turn-gate-p1`, `turn-select-p1` (zones à toucher),
  `turn-gate-p2`, `turn-gate-p2-late` (`mobileOnly`) ; les états en ligne restent identiques après l'extraction
  d'`ElementPicks`. **A11y** : voile et tour de J1 audités (axe, contraste), voile utilisable au clavier.
Depuis PFC-026 (démo des confrontations, D49) :
- **Unitaires** : `demo.test.ts` (neuf confrontations × deux côtés : résolution égale à `resolveRound`, vainqueur = côté
  choisi hors effets symétriques ; départs de la maquette ; S1 Eau + Eau 2/2 → 1/1 aux échéances D09 puis repos sans
  manche suivante ; S2 lancement ignoré à chaque phase ; échéance idempotente ; commandes de scène : aucun élément
  avant la révélation, entrée, verrous, révélation, effet, repos) ; `Stage.test.tsx` (ouverture sans toast, S1/S2 à
  l'écran, bouton activé gardant le focus, vainqueur à droite, Échap et « Accueil » rendant le focus, trophées d'une
  partie jouée ensuite inchangés, pont de scène propre à la démo) ; `timing-sync.test.ts` (`DEMO_ARM_MS`).
- **E2E** `tests/e2e/demo.spec.ts` (3 navigateurs, horloge figée) : parcours au clavier seul (S1, S2 au clavier et au
  pointeur, retour au repos, Échap), vainqueur à droite, repli sans WebGL, audit axe + contraste au repos et pendant un
  effet. Un bouton `aria-disabled` est cliqué avec `force` : Playwright le jugerait inactif, un pointeur l'atteint.
  Firefox ne reboucle pas la tabulation après le dernier contrôle : viser un contrôle placé après le focus courant.
- **Parité visuelle** (maquette, tolérance nulle) : `demo`, `demo-reveal`, `demo-result` (bureau et téléphone) et
  `demo-after` (bureau), « Eau › Feu » (texte commun aux deux rendus, D41). Le parcours règle d'abord X = 3 des deux
  côtés (défaut de la maquette : 5, D07). L'état « verrous » (0,7 s) n'est pas capturé (écart assumé, D49).
- **3D réelle** (hors gate, GPU Intel Iris Xe via D3D12/WSLg, Chromium avec fenêtre, script jetable) : les 18
  confrontations (9 × 2 côtés) jouées sur la scène réelle, sans repli ni erreur console. Sous ce compositeur, les
  boutons atténués d'un panneau flouté montrent des diagonales : la maquette les montre à l'identique (artefact de
  plateforme, absent du rendu de référence).
- Mutations contrôlées (restaurées), détectées : garde de lancement retirée (S2 échoue, unitaire et écran) ; éléments
  montrés avant la révélation (scène et statuts, 2 tests échouent).
- **Délais du gate** : avec 12 tests de plus, l'ordonnancement parallèle a fait croiser « scène 3D réelle sous CSP »
  (`security.spec.ts`, 8 s seul) avec les tests 3D réels de `scene.spec.ts` et `performance.spec.ts` : délai de 30 s
  dépassé deux fois de suite (32 s). Délai porté à 120 s, comme les autres tests en rendu logiciel. La borne X = 10
  (`local.spec.ts`, une vingtaine de manches, 22 s seule sous WebKit, 33,5 s une fois au gate) passe en `test.slow()`.
Pour un ticket purement documentaire : liens, IDs, cohérence et diff suffisent ; ne pas prétendre
que le build a été exécuté dans un dossier sans application. Pour les tickets code, exécuter les
gates disponibles, noter précisément ceux que les dépendances ne permettent pas encore.
Le gate de release complet est obligatoire à PFC-023.

## Stratégie
- Domaine : 9 couples, les 3 relations de score pour plante/plante, plancher zéro, X=1 et X=10,
  nul ON/OFF, scores > X, prolongation puis baisse sous X, résolution/attribution unique.
- Propriétés : entiers ≥ 0, symétrie par échange des joueurs, immutabilité, déterminisme,
  pas de mutation à phase invalide, pas d'attribution hors match terminé.
- Contrôleurs : faux temps injecté, premier choix verrouillé, double saisie, Espace maintenu,
  focus d'un champ/bouton, démontage et StrictMode, revanche et remise à zéro.
- Worker : deux connexions, troisième refusée, entrées invalides, double requête, état restauré,
  alarme répétée, erreur de stockage, reconnexion, ancienne socket et isolation entre rooms.
- E2E : local clavier complet et deux BrowserContexts indépendants en ligne ; pas de socket mockée
  pour prouver le multijoueur. Attendre des états observables, jamais des sleeps arbitraires.
- Visuel : effets identiques distincts, petit écran, reduced-motion et fallback WebGL. Tests de
  comportement séparés des captures pour ne pas dépendre du hasard des particules.

Les blocs Gherkin des tickets sont des critères lisibles, pas une suite déjà exécutable.
Les traduire en tests Vitest/Playwright portant l'ID ticket et scénario. Cucumber n'est pas requis.
Les fixtures qui injectent scores/horloge pour les tests n'existent jamais dans l'API de production.
Capturer les trames serveur → clients des deux connexions pour vérifier l'absence de fuite avant
révélation. Les commandes client → serveur transmettent nécessairement le choix du joueur lui-même ;
elles ne constituent pas une fuite adverse.

## DoD commune pour un ticket code
- [ ] Tous les critères d'acceptation prouvés, y compris les cas d'erreur du ticket.
- [ ] Tests proportionnés au risque, test de régression pour chaque bug corrigé.
- [ ] TypeScript strict, aucune suppression de diagnostic pour masquer un problème.
- [ ] Build puis fonctionnel puis lint puis E2E disponibles passent ; commandes et résultats consignés.
- [ ] Aucun secret, log sensible, dépendance ou changement de périmètre non justifié.
- [ ] États loading/erreur et accessibilité traités pour les interactions ajoutées.
- [ ] SPEC/contrat réseau/tickets dépendants mis à jour si nécessaire.
- [ ] Diff relu ; limites restantes explicites ; statut reflète les preuves, pas l'intention.

## CI et staging (PFC-022, D48)
`.github/workflows/ci.yml` : sur push `main` et pull request, job `verify` = clone propre, `npm ci`, navigateurs
Playwright avec dépendances, puis `build` → `test:functional` → `lint` → `test:e2e` (étapes distinctes, arrêt au premier
échec), avec `CLOUDFLARE_ENV=staging`. Succès : artefact `dist-staging` (7 jours). Échec : rapport et traces Playwright
(7 jours ; seuls des tokens de rooms éphémères du workerd local). Staging : **Run workflow** avec `deploy_staging`
depuis `main` → job `deploy-staging` (après `verify` vert) : publication de l'artefact téléchargé, puis `npm run test:smoke`
contre https://elem3nts-staging.bluestarz.workers.dev. Contrat vérifié dans le gate par `tests/tooling/ci.test.ts`.
Équivalent local : `CLOUDFLARE_ENV=staging npm run verify && npm run deploy:staging && SMOKE_URL=<url> npm run test:smoke`.
Un `npm run verify` sans `CLOUDFLARE_ENV` construit l'artefact de production : `deploy:staging` le refuse.
Le gate doit passer avec et sans `CLOUDFLARE_ENV` : wrangler lit cette variable par défaut (y compris
`unstable_readConfig`) ; un test qui lit la configuration d'un environnement précis la neutralise (`config.test.ts`,
écart trouvé par la copie propre de PFC-022).
Fins de ligne : `.gitattributes` impose LF à l'extraction (`* text=auto eol=lf`) ; sans lui, un clone sur un poste en
`core.autocrlf=true` (cas du poste du propriétaire) sortait en CRLF et faisait échouer `config.test.ts` et `engine-port.test.ts`.

## Release
Procédure effective (PFC-023, D50) : docs/RUNBOOK.md « Livrer en production » : CI GitHub verte sur le commit, staging
publiée depuis ce commit et smoke vert, puis extraction propre → `npm ci` → `npm run verify` → `deploy:production`
→ smoke de production (local et en ligne) → version et tag consignés. Une régression en recette arrête la livraison
(preuve PFC-023-S2 : trophée doublé injecté, gate fonctionnel rouge, publication jamais atteinte).
Clone propre → npm ci → installation des navigateurs Playwright avec dépendances → verify.
En CI, conserver traces/captures/rapport en cas d'échec, avec rétention bornée ; aucun token en artifact.
Smoke staging puis production : deux vrais clients, choix, révélation, trophée, revanche,
reconnexion et reload de route SPA. Préparer rollback et compatibilité des rooms persistées.
Mesure cible de rendu : environ 60 fps sur machine de référence documentée ; jamais un critère
annoncé sans mesure. Aucun bug bloquant sur le parcours principal ; aucun accès réseau secret
ou état caché exposé. La disponibilité de secrets Cloudflare peut bloquer le déploiement,
mais ne bloque pas l'implémentation et les vérifications locales.
