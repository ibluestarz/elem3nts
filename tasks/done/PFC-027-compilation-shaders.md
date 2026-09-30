# PFC-027 — Ouverture sans compilation bloquante des shaders

- Statut : done
- Priorité : P2 (optimisation mesurée, non requise pour la release)
- Lot : M3
- Dépendances : PFC-008, PFC-021

## Contexte et objectif
Mesure PFC-021 (D46, profil CDP de l'ouverture à froid, profil mobile Lighthouse) : après le téléchargement du moteur,
la compilation synchrone d'environ 65 programmes WebGL au premier rendu (`getUniforms` de three.js) occupe ≈ 2,7 s de
CPU ×4 avant l'accueil interactif (9,5 s au total). Objectif : compiler sans bloquer le fil principal pendant l'écran
d'ouverture, pour un accueil interactif plus tôt, rendu inchangé.

## Périmètre
Inclus : compilation asynchrone (`renderer.compileAsync`, extension `KHR_parallel_shader_compile`) de la scène avant
l'état `ready`, par un correctif supplémentaire de `scripts/port-engine.ts` (test de dérive) et l'adaptation de
`useSceneHost` ; mesure avant/après par `npm run measure:load` et `npm run measure:scene`.
Exclus : toute modification visuelle de la scène ou de l'interface ; changement de version de three.

## Règles et contraintes
D33 (moteur porté fidèlement, correctifs listés et appliqués une seule fois, repli après 8 s) ; D46 (méthode et
valeurs de référence) ; rendu 3D comparé à la maquette avec la tolérance calibrée de `scene.spec.ts`.

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| Cache froid, profil mobile Lighthouse | ouverture | accueil interactif plus tôt que 9,5 s (médiane de 9 passages), même rendu |
| Navigateur sans `KHR_parallel_shader_compile` | ouverture | comportement actuel, sans erreur |

## Critères d'acceptation
- [x] AC1 : gain mesuré de l'accueil interactif à froid (médianes avant/après, même machine), consigné dans D46.
- [x] AC2 : rendu 3D identique (tests de parité de `scene.spec.ts`), repli et chien de garde inchangés.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Ouverture sans compilation bloquante
  Scénario: PFC-027-S1 — Compilation pendant l'écran d'ouverture
    Étant donné un cache froid et le profil mobile de Lighthouse
    Quand l'application s'ouvre
    Alors l'accueil devient interactif plus tôt qu'avant, avec le même rendu
  Scénario: PFC-027-S2 — Extension absente
    Étant donné un navigateur sans compilation parallèle des shaders
    Quand l'application s'ouvre
    Alors elle se comporte comme avant, sans erreur
```

## Tests et vérification
`npm run measure:load` (RUNS=9) avant/après ; `tests/e2e/scene.spec.ts` et `performance.spec.ts` verts ; gate complet.

## Definition of Done
- [x] [DoD commune](../../docs/TESTING.md) satisfaite pour ce périmètre.
- [x] Mesures avant/après consignées (D46, D51, ARCHITECTURE « Rendu et qualité »).
- [x] Suivi et dépendances mis à jour.

## Suivi
- Implémentation : terminée (2026-09-30).
  - `scripts/port-engine.ts` : 3 correctifs ajoutés (10 au total) et le correctif `destroy` complété (`this.gone`).
    (a) Aucune image avant `warm` : ni rAF à la construction, ni filet de 60 ms. (b) `warm(ms)`, dans une tâche à
    part : visibilité des acteurs posée comme le premier `update` (sans son aléa) ; `renderer.compile` de la scène, et
    en qualité haute des opaques sous une cible 1×1 (variantes de la passe de transmission) ; suivi de `isReady()` toutes
    les 10 ms ; uniformes et attributs lus par tranches de 20 ms avant tout dessin ; puis boucle. (c) Cible de `warm`
    créée avant le contexte WebGL (son `uuid` tire `Math.random`). `engine.js` régénéré, `engine.d.ts` documenté.
  - `useSceneHost.ts` : qualité enregistrée appliquée avant `warm` ; `ready`, chien de garde et sonde `?perf` après
    `warm`, seulement si le moteur n'a été ni remplacé, ni démonté, ni perdu entre-temps ; budget = temps restant avant
    l'échéance des 8 s (délai de chargement inchangé, levé à la construction) ; échec → moteur détruit, repli « failed ».
  - `measure-load.ts` : colonnes « Blocage > 50 ms » et « Plus longue tâche » (tâches longues jusqu'à l'accueil).
- Remise en cause du ticket (D51) :
  - `renderer.compileAsync` (demandé par le ticket) est écarté. Dans three r160, il lève après `destroy` (programme
    indéfini, dans un `setTimeout`) et boucle sans fin après une perte de contexte. Même principe réécrit avec gardes.
  - Compiler seul ne suffisait pas (mesuré : 10 716 ms, aucun gain). Diagnostic par appels GL chronométrés et piles :
    (1) le goulot n'était pas l'édition de liens mais les appels synchrones de la 1re initialisation de chaque
    programme, intercalés entre des dessins et attendant la compilation paresseuse du pilote au premier dessin → lecture
    des uniformes avant tout dessin ; (2) `compile()` voyait 10 lumières ponctuelles (acteurs tous visibles avant le
    premier `update`), donc toutes les clés différaient de la 1re image → visibilité alignée ; (3) la passe de
    transmission de l'eau utilise d'autres variantes (sans tone mapping) → précompilées ; (4) matériaux double face
    à deux programmes → tous les programmes du matériau lus.
  - Qualité enregistrée appliquée avant la compilation (sinon tout serait recompilé au premier réglage « basse »).
  - Horloge figée des E2E : le suivi minuté ne progresserait pas → `awaitScene` (pas de 10 ms au rythme réel).
- Commandes exécutées / résultats (même machine : i5-1155G7, Iris Xe via D3D12/WSLg, Chromium 153 avec fenêtre) :
  - `RUNS=9 npm run measure:load`, builds avant (HEAD 2158970, worktree temporaire) et après servis côte à côte, séries
    alternées avant-après-après-avant. Froid : 10 323 / 10 252 → **8 397 / 8 289 ms** ; blocage > 50 ms 4 056 / 4 007
    → 2 022 / 2 028 ms ; plus longue tâche 2 815 / 2 778 → 744 / 789 ms ; visite suivante 5 580 / 5 195 → 4 650 /
    4 719 ms. Une série isolée juste après le gate a donné 9 046 ms (machine chaude), d'où la mesure alternée.
  - `npm run measure:scene` avant/après : médianes 16,7 ms inchangées à toutes qualités, éclairs ≤ 1/s.
  - `npm run verify` (état final) : build OK, 52 fichiers / 848 tests fonctionnels, ESLint 0 avertissement,
    Playwright 309 passés / 22 ignorés (par conception), exit 0. Un gate intermédiaire avait échoué : parité 3D à
    609 pixels (aléa décalé par la cible de rendu, corrigé) et 2 tests a11y Firefox en dépassement de 5 s sous charge
    (moteur bouchonné, hors périmètre ; 8/8 relancés seuls, verts au gate final).
  - Mutations contrôlées (restaurées) : alignement de visibilité retiré → 34 programmes liés par la boucle, S2 échoue ;
    hôte qui n'attend plus `warm` → unitaire « reste en chargement » échoue.
- Preuves / fichiers : `scripts/{port-engine,measure-load}.ts`, `src/client/scene/{engine.js,engine.d.ts,useSceneHost.ts}`,
  `tests/unit/client/sceneHost.test.tsx`, `tests/tooling/engine-port.test.ts`,
  `tests/e2e/{support,scene.spec,performance.spec,security.spec}.ts`, docs D33, D46, D51, ARCHITECTURE, TESTING.
- Blocages / décisions nouvelles : D51 (choix proposé par défaut). Limite : les premières images coûtent encore
  ≈ 0,5–0,9 s (CPU ×4) après l'apparition de l'accueil (3 programmes d'ombre internes à three.js, compilation du pilote
  au premier dessin). Chromium sans fenêtre (SwiftShader, gate et CI) n'expose pas `KHR_parallel_shader_compile` :
  le chemin avec extension y est simulé ; le vrai GPU est mesuré hors gate.
