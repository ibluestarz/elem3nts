# PFC-026 — Démo des confrontations

- Statut : done
- Priorité : P1
- Lot : M1
- Dépendances : PFC-008

## Contexte et objectif
L'accueil de la maquette propose « Démo des confrontations » : l'arène rejoue à la demande chacune des neuf
confrontations avec son effet 3D et son explication. Depuis PFC-004, le bouton annonce « bientôt disponible »
par un toast (D29). PFC-008 livre la scène et les effets ; cet écran les rend consultables hors partie.

## Périmètre
Inclus : écran `demo` de la maquette (panneau « Démo · rejouer chaque confrontation », sélecteur « Vainqueur
À gauche / À droite », bouton « Accueil », neuf boutons), rejouées avec les mêmes échéances et le même pont de
scène que la partie ; Échap et « Accueil » ramènent à l'accueil ; repli DOM sans WebGL.
Exclus : toute session ou trophée (la démo ne compte rien), mode en ligne, nouvel effet visuel.

## Règles et contraintes
Maquette `runDemo` : scores 2/2 (1/3 ou 3/1 pour « écart »), choix imposés selon le côté vainqueur, révélation
puis effet, retour à l'état d'attente sans manche suivante ; boutons à opacité 0,4 pendant un effet et inactifs.
Les textes et deltas viennent de `resolveRound` (D25) ; la scène ne calcule rien (ARCHITECTURE, D33).
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md), [architecture](../../docs/ARCHITECTURE.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| démo, vainqueur à gauche | « Eau + Eau » | verrous 0,7 s, révélation eau/eau, effet siphon, bannière « La mer engloutit tout — −1 pour les 2 joueurs » (D41), 2/2 → 1/1 |
| un effet en cours | clic sur une autre confrontation | ignoré, boutons atténués jusqu'à la fin de l'effet |

## Critères d'acceptation
- [x] AC1 : les neuf confrontations se rejouent avec l'explication et les deltas du moteur pur, des deux côtés.
- [x] AC2 : aucune manche suivante, aucun trophée, aucun score de session modifié ; Échap revient à l'accueil.
- [x] AC3 : rendu DOM identique à la maquette (D28) au repos et pendant un effet.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Démo des confrontations
  Scénario: PFC-026-S1 — Double eau rejouée
    Étant donné l'écran de démo avec le vainqueur à gauche
    Quand « Eau + Eau » est choisi
    Alors l'effet siphon et « La mer engloutit tout — −1 pour les 2 joueurs » (D41) apparaissent puis la démo revient au repos
  Scénario: PFC-026-S2 — Effet en cours
    Étant donné une confrontation en cours de démonstration
    Quand une autre confrontation est choisie
    Alors elle est ignorée
```

## Tests et vérification
Vitest (état de démo, garde pendant un effet) ; Playwright parité visuelle Chromium et parcours clavier 3 moteurs.

## Definition of Done
- [x] [DoD commune](../../docs/TESTING.md) satisfaite pour ce périmètre.
- [x] D29 mis à jour : le bouton ouvre la démo (D49).
- [x] Suivi et dépendances mis à jour.

## Suivi
- Implémentation : terminée (2026-09-30).
  - `src/client/state/demo.ts` : reducer pur (`idle → armed → reveal → clash → result → idle`), départs de la maquette
    (`demoSetup`), résolution par `resolveRound` au lancement, échéances D09 + 0,7 s de verrous, garde de lancement ;
    `demoSceneView` pour le pont de scène (écran `demo` ajouté à `sceneCommands`).
  - `src/client/screens/DemoScreen.tsx/.css` : panneau de la maquette (vainqueur `aria-pressed`, « Accueil », neuf
    boutons `aria-disabled` à 0,4 pendant un effet), arène commune `ArenaFrame` (titre, sans « Quitter »), reducer,
    horloge (`useCycle`) et pont propres ; entrée animée, survol, appui et focus ; jetons `--line-quiet`,
    `--line-hairline`, `--surface-glass-panel`, `--surface-wash`.
  - `Stage.tsx` : écran `demo`, plus de toast pour la démo, Échap et « Accueil » rendent le focus au bouton de l'accueil,
    pont de l'application retiré pendant la démo. `copy.ts` : `DEMO_LABELS`, `resultAnnouncement` (annonce de résultat
    auparavant dupliquée dans `Arena.tsx` et `online/game.ts`).
- Remise en cause du ticket (D49) : exemple et S1 corrigés vers les textes D41 (« La mer engloutit tout ») ; verrous
  avant révélation selon l'intention de la maquette (bogue de la maquette : « Aucun choix » puis éléments précédents) —
  choix du propriétaire (2026-09-30) ; `aria-disabled` plutôt que `disabled` (focus conservé) ; mêmes échéances avec
  ou sans 3D ; X de la préparation dans « premier à X ».
- Commandes exécutées / résultats :
  - `npx vitest run --project client tests/unit/client/{demo,Stage,sceneCommands}.test.*` : 96 passed.
  - `npm run baseline:mockup -- --only demo` : 7 références écrites depuis la maquette (aucune autre modifiée).
  - `npx playwright test visual.spec.ts --project=chromium --grep demo` : 7 passed (tolérance nulle), après avoir retiré
    « Échap · Quitter », absent de la maquette en démo.
  - `npx playwright test demo.spec.ts setup.spec.ts` : 3 navigateurs, tous passés (après deux corrections du test :
    clic forcé sur un bouton `aria-disabled`, cible de tabulation sous Firefox).
  - Mutations contrôlées (restaurées), détectées : garde de lancement retirée ; éléments montrés avant la révélation.
  - Scène 3D réelle, GPU Intel Iris Xe (Chromium avec fenêtre, script jetable) : 18 confrontations jouées, textes du
    moteur, boutons à 0,4, aucun repli ni erreur console ; Échap rend le focus.
  - `npm run verify` n° 1 : build, Vitest 841 passed, ESLint OK, Playwright 305 passed / **2 failed** (délais de 30 s
    dépassés sous charge : `security.spec.ts` scène réelle sous CSP, `local.spec.ts` X = 10 WebKit ; tous deux passent
    seuls). `npm run test:e2e` : 306 passed / 1 failed (le même test de sécurité, 32 s). Délais corrigés (TESTING).
  - `npm run verify` n° 2 : **EXIT 0** — build OK ; Vitest 52 fichiers, 843 passed ; ESLint 0 warning ; Playwright
    307 passed (15,9 min).
- Preuves / fichiers : `tests/unit/client/demo.test.ts`, `tests/unit/client/Stage.test.tsx`,
  `tests/unit/client/timing-sync.test.ts`, `tests/e2e/demo.spec.ts`, `tests/e2e/support.ts` (états `demo*`),
  `tests/e2e/__screenshots__/visual.spec.ts/demo-*.png` ; docs : D29, D49, ARCHITECTURE, TESTING « Depuis PFC-026 »,
  TRACEABILITY.
- Blocages / décisions nouvelles : D49. Limites : l'état « verrous » (0,7 s) n'a pas de référence visuelle (écart
  assumé) ; sous le compositeur GPU de WSLg, les boutons atténués montrent des diagonales, à l'identique dans la
  maquette (artefact de plateforme). Créé pendant PFC-008 (2026-09-28).
