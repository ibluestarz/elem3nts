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
| npm run deploy:* | Non créées | PFC-022 / PFC-023 |

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

## Release
Clone propre → npm ci → installation des navigateurs Playwright avec dépendances → verify.
En CI, conserver traces/captures/rapport en cas d'échec, avec rétention bornée ; aucun token en artifact.
Smoke staging puis production : deux vrais clients, choix, révélation, trophée, revanche,
reconnexion et reload de route SPA. Préparer rollback et compatibilité des rooms persistées.
Mesure cible de rendu : environ 60 fps sur machine de référence documentée ; jamais un critère
annoncé sans mesure. Aucun bug bloquant sur le parcours principal ; aucun accès réseau secret
ou état caché exposé. La disponibilité de secrets Cloudflare peut bloquer le déploiement,
mais ne bloque pas l'implémentation et les vérifications locales.
