# PFC-008 — Arène Three.js et effets des éléments identiques

- Statut : done
- Priorité : P1
- Lot : M1
- Dépendances : PFC-006, PFC-007

## Contexte et objectif
Rendre les confrontations reconnaissables sans fragiliser le jeu.

## Périmètre
Scène légère, effets révélation et trois effets doubles distincts, fallback DOM, reduced-motion. Exclut assets payants et pipeline 3D complexe.

## Règles et contraintes
ARCHITECTURE rendu ; effets déclenchés par roundId révélé, jamais par choix cachés ; aucune logique de score dans la scène.
Depuis PFC-006 : impact et fin d'effet suivent les échéances `CYCLE_MS` (chemin sans moteur de la maquette) ; la maquette
cale l'impact sur `clash(kind, winner, onImpact, onDone)` : décider si le reducer attend la scène ou garde ses échéances.
Décidé (D09, D33) : le reducer garde ses échéances, alignées sur la durée et l'impact de chaque effet du moteur.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| une révélation eau/eau | la scène reçoit le résultat de manche | un effet distinct du double feu et le texte de perte de point apparaissent |
| WebGL est indisponible | une partie est jouée | les commandes, scores et résultats restent utilisables dans le DOM |

## Critères d'acceptation
- [x] AC1 : Feu/feu, eau/eau et plante/plante ont des effets distincts et une explication textuelle.
- [x] AC2 : WebGL absent/perdu laisse le jeu jouable ; reduced-motion réduit les effets.
- [x] AC3 : Ressources GPU, listeners et animation frames libérés ; pas de boucle supplémentaire à la revanche.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Arène Three.js et effets des éléments identiques
  Scénario: PFC-008-S1 — Double eau
    Étant donné une révélation eau/eau
    Quand la scène reçoit le résultat de manche
    Alors un effet distinct du double feu et le texte de perte de point apparaissent
  Scénario: PFC-008-S2 — Sans WebGL
    Étant donné WebGL est indisponible
    Quand une partie est jouée
    Alors les commandes, scores et résultats restent utilisables dans le DOM
```

## Tests et vérification
Playwright fallback et reduced-motion ; captures des 3 effets et mesure frame time sur machine documentée ; inspection nettoyage après plusieurs revanches.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-008-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : terminée le 2026-09-28 (arbitrages du propriétaire : port fidèle du moteur, interface au pixel
  + 3D à tolérance calibrée, échéances du moteur partout, repli DOM avec toast).
  - Moteur de la maquette porté par `scripts/port-engine.ts` → `src/client/scene/engine.js` (three@0.160.0 exact,
    7 correctifs en en-tête : import npm, export, globaux supprimés, perte de contexte, pas de rendu onglet masqué,
    `destroy` qui libère géométries, matériaux, textures, environnement et contexte). `diff` avec la maquette :
    seuls ces correctifs apparaissent ; un test de dérive le garantit.
  - `useSceneHost` (une instance, chargement paresseux, délai 8 s, perte de contexte, chien de garde de fréquence
    d'images), `sceneContext`, `sceneCommands` pur + `useSceneBridge` (verrous sans élément, éléments seulement à
    la révélation), étiquettes projetées des trois éléments dans l'arène, toast de repli unique par cause.
  - Reducer : nouvelle phase `clash`, chronologie `CLASH_TIMING` du moteur (impact `round(D×I)`, puis D + 1,6 s).
- Remise en question appliquée :
  - coquille du scénario S1 corrigée (« effet distinct **du** double feu ») ;
  - l'overlay bloquant de la maquette sans WebGL est remplacé par le jeu DOM complet et un toast ;
  - moteur de la maquette insuffisant pour AC3 (`destroy` ne libérait que le renderer, rendu en arrière-plan par
    son `setInterval`, global `window.__e3`) : corrigé par patchs vérifiés ;
  - ajout d'un chien de garde de performance : en rendu logiciel, la scène tient ~1 image/s et gênerait le jeu ;
  - « Démo des confrontations », rattachée à PFC-008 par D29 mais hors périmètre : ticket PFC-026 créé.
- Défauts trouvés en cours de route : ref de canvas détachée par StrictMode (React 19) → ref de rappel en état ;
  avertissement Firefox « WebGL context was lost » causé par la sonde → sonde sans `loseContext` ; compteur
  d'images doublement enveloppé dans le test AC3 ; préférence mémorisée masquant `prefers-reduced-motion` dans
  le test (le comportement produit, D29, est correct) ; test des effets trop lent sous charge → une seule partie.
- Mesures (2026-09-28, i5-1155G7, WSL2 sans GPU, Chromium headless SwiftShader, 1280×800) : ~1 131 ms par image
  en qualité haute, ~521 ms en basse (options Chromium par défaut : 1 365 / 597). Variation propre de la
  maquette : 3 rendus distincts sur 4, jusqu'à 3,9 % de pixels, ≤ 0,013 % au-delà de 25 niveaux → tolérance
  seuil 0,1, 0,05 % de pixels. Application déterministe (identique à l'une des variantes de la maquette).
  Mouvements réduits : 4,46 % d'écarts forts sur l'impact feu+feu ; effets distincts deux à deux > 1 %.
- Commandes exécutées / résultats :
  - `npm run verify` : build OK ; Vitest 22 fichiers, 288 tests OK ; ESLint 0 avertissement ; Playwright 107 OK,
    12 ignorés (tests 3D réels réservés à Chromium, raison déclarée dans le test), 0 échec. Après l'ajout du test
    « pause » de la projection : `npm run build`, `npm run test:functional` (289 tests) et `npm run lint` rejoués, verts.
  - Stabilité : `visual`, `cycle`, `rematch`, `keyboard` `--repeat-each=5` sur 3 navigateurs : 340/340 ;
    `scene.spec.ts` Chromium `--repeat-each=3` : 21/21.
  - `npm run dev`, Chromium, Firefox et WebKit, avec et sans WebGL : scène `ready` ou repli avec toast, manche
    feu/plante jouée et expliquée. Seul avertissement : Firefox « WebGL warning: generateMipmap … lazy
    initialization », émis à l'identique par la maquette (indication de performance du moteur, pas une erreur).
  - Mutations (chacune restaurée, vérifiée par `cmp`) : mouvements réduits non transmis → E2E en échec (0 % d'écart) ;
    Vitest en échec pour : éléments projetés hors révélation (survivante au premier passage, équivalente pour le
    secret car le reducer ne remplit `revealed` qu'à la révélation : test « pause » ajouté), élément joint aux
    verrous, `reset` d'après-manche retiré, perte de contexte ignorée, délai de chargement ignoré, `destroy` au
    démontage retiré, chien de garde sans `destroy`, chien de garde mesurant l'onglet masqué, moteur rendant
    onglet masqué, `destroy` du moteur sans libération.
  - `npm run port:engine` rejoué : fichier identique au bit près (`cmp`). Références d'interface de la maquette
    recapturées 3 fois pendant le ticket : identiques.
- Preuves / fichiers : `src/client/scene/*`, `src/client/{App,Stage}.tsx`, `src/client/App.css`,
  `src/client/screens/Arena.{tsx,css}`, `src/client/state/game.ts`, `scripts/port-engine.ts`,
  `scripts/capture-mockup-baseline.ts`, `eslint.config.js`, `tsconfig.test.json`, `vite.config.ts`,
  `package.json` (+ lockfile : three, @types/three 0.160.0) ; tests `tests/unit/client/{sceneCommands,
  sceneBridge,frameWatch,timing-sync}.test.ts*`, `sceneHost*.test.tsx`, `Stage.test.tsx`, `game.test.ts`,
  `tests/tooling/engine-port.test.ts`, `tests/e2e/{scene,visual,cycle,rematch,keyboard}.spec.ts`,
  `tests/e2e/{support,timing}.ts`, référence `tests/e2e/__screenshots__/scene.spec.ts/scene-home-1280x800.png`.
  Docs : DECISIONS (D09, D29, D31, D33), SPEC (cycle), ARCHITECTURE (scène, mesures), TESTING, TRACEABILITY ;
  notes dans PFC-014 et PFC-021 ; nouveau ticket PFC-026.
- Blocages / limites : parité 3D et tests de scène réelle sous Chromium seulement (rendu logiciel
  reproductible) ; Firefox et WebKit couverts pour le repli sans WebGL. Aucune mesure sur vrai GPU sur cette
  machine : PFC-021. `npm run dev` ne lance pas encore le Worker (PFC-011).
