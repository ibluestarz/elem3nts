# PFC-021 — Accessibilité et performance de la version complète

- Statut : done
- Priorité : P1
- Lot : M3
- Dépendances : PFC-009, PFC-019

## Contexte et objectif
Conserver une expérience lisible et réactive dans les deux modes.

## Périmètre
Parcours clavier, annonces, responsive, contrastes, reduced-motion, GPU et bundles. Exclut refonte graphique hors besoins mesurés.

## Règles et contraintes
SPEC saisie et ARCHITECTURE rendu ; ne pas dépendre de la seule couleur ; UX inchangée sans WebGL.
Depuis PFC-008 (D33) : seul le rendu logiciel a été mesuré (~1,1 s/image, repli « trop lent » déclenché) ;
mesurer sur vrai GPU (bureau et téléphone) le temps d'image par qualité et valider le seuil du chien de garde
(médiane de 20 images > 150 ms) ; le chunk `engine-*.js` pèse 541 kB (140 kB gzip), chargé pendant l'ouverture.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| l’utilisateur n’utilise pas la souris | il configure puis joue et relance une partie | tous les contrôles restent accessibles avec focus visible |
| prefers-reduced-motion est activé | une révélation a lieu | le résultat est lisible sans animation intense |

## Critères d'acceptation
- [x] AC1 : Parcours réalisables au clavier, focus restauré, scores/résultats accessibles ; contrôles mobiles en ligne utilisables.
- [x] AC2 : Absence de WebGL ou reduced-motion ne bloque aucune action.
- [x] AC3 : Mesures frame time et taille bundle documentées ; pas de fuite de listeners/GPU après 20 revanches ; optimisation guidée par mesure.
  Temps d'image sur un vrai téléphone : relevé par le propriétaire (iPhone, iOS 26.6.2, Apple GPU, WebKit (app Google), 428×745 @3x, 2026-09-29) : médiane 17 ms à toutes qualités, éclairs 0/s (D46).

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Accessibilité et performance de la version complète
  Scénario: PFC-021-S1 — Navigation clavier
    Étant donné l’utilisateur n’utilise pas la souris
    Quand il configure puis joue et relance une partie
    Alors tous les contrôles restent accessibles avec focus visible
  Scénario: PFC-021-S2 — Animations réduites
    Étant donné prefers-reduced-motion est activé
    Quand une révélation a lieu
    Alors le résultat est lisible sans animation intense
```

## Tests et vérification
Playwright clavier/petits viewports, audit a11y automatisé complété manuellement ; profilage machine/navigateur notés.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-021-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : terminée sauf la mesure sur téléphone réel (2026-09-29). Revue senior du ticket : l'audit a trouvé
  et corrigé de vrais défauts, le rendu de la maquette est intact (parité visuelle verte, aucune couleur modifiée).
  - Focus : piège jamais attaché au dialogue « Connexion interrompue » (monté après coup) → `useFocusTrap(ref, active)`,
    Maj+Tab depuis le titre gardé ; Espace/Échap n'agissent plus derrière ce dialogue (Échap quittait la room) ;
    focus rendu au déclencheur au retour des Réglages vers la préparation ; focus jamais laissé au `<body>` quand un
    contrôle disparaît (zones de choix, notification fermée, dialogue refermé) ; verdict décrit par le vainqueur.
  - Clavier : Espace sur l'accueil ouvrait la préparation **sans nouvelle session** (trophées conservés, contraire à
    D13 et au bouton) → même action que « Jouer en local ».
  - Mouvements réduits : la requête média écrasait le réglage « Mouvements réduits » désactivé, et tout
    enregistrement figeait la préférence système → choix explicite prioritaire, système suivi en direct, attribut
    posé avant l'écran d'ouverture.
  - Performance : cache `immutable` des fichiers à empreinte (`public/_headers`) ; `modulepreload` du moteur et
    préchargement des polices mesurés puis écartés ; goulot restant documenté → ticket PFC-027.
  - Outils : audit axe + contraste mesuré (`tests/e2e/audit.ts`), sonde de temps d'image et d'éclairs en
    développement (`?perf`, absente du build, vérifié), `npm run measure:scene`, `npm run measure:load`.
- Commandes exécutées / résultats (Node v24.21.0) :
  - `npm run measure:scene` ×2 (GPU Intel Iris Xe via D3D12/WSLg, Chromium 153 avec fenêtre) : médiane 16,7 ms à
    toutes qualités, 1280×800 et 390×844 @3x ; éclairs ≤ 1/s, variation ≤ 0,037. Chromium sans fenêtre = SwiftShader.
  - `RUNS=9 npm run measure:load` sur 4 variantes (référence, modulepreload, cache immuable, les deux) + polices
    (5 passages) ; profil CPU CDP de l'ouverture. Chiffres : D46.
  - `npx playwright test a11y.spec.ts` : 30 passed (3 navigateurs) ; `performance.spec.ts` : passed ;
    `security.spec.ts local.spec.ts` : 36 passed ; mutations (liste dans TESTING « Depuis PFC-021 ») toutes détectées.
  - Premier `npm run verify` : EXIT 1 — build, Vitest 785/785, ESLint OK ; Playwright 264 passed, 5 failed : le test
    des 20 revanches en 1280×800 haute qualité (15 min) affamait le gate parallèle (échéances réelles de 5 s manquées
    sous WebKit, délai de `security.spec`). Corrigé (basse qualité 800×450, géométrie tactile en un aller-retour) ;
    échecs repassés isolément.
  - Deuxième `npm run verify` : EXIT 1 — Playwright 264 passed, 5 failed (lobby WebKit, `security.spec.ts`). Constaté :
    les contextes en ligne ouverts par `a11y.spec.ts` n'étaient jamais fermés (sockets et minuteries vivants dans le
    processus, captures d'échec montrant des écrans de fin étrangers au test) → `afterEach` qui ferme tout contexte
    ouvert, même en échec. Causes directes établies ensuite par PFC-022 (traces) : `security.spec.ts` bloqué par la
    compilation synchrone des shaders de la vraie scène (goulot PFC-027), lobby WebKit par une assertion d'URL sans
    nouvel essai ; deux courses corrigées dans PFC-022. La charge ajoutée par les contextes non fermés les rendait
    plus fréquentes.
  - Troisième `npm run verify` : **EXIT 0** — build OK ; Vitest 50 fichiers, 785 tests passed ; ESLint 0 warning ;
    Playwright 269 passed, 18 skipped (15,0 min).
- Preuves / fichiers : `tests/e2e/a11y.spec.ts`, `tests/e2e/performance.spec.ts`, `tests/e2e/audit.ts`,
  `tests/unit/client/focusTrap.test.tsx` + cas PFC-021 de `preferences`, `Stage`, `OnlineReconnect`, `OnlineGame` ;
  `src/client/{hooks/useFocusTrap.ts, screens/online/ConnectionLost.tsx, screens/OnlineScreen.tsx,
  screens/ArenaFrame.tsx, screens/EndScreen.tsx, screens/SetupScreen.tsx, Stage.tsx, components/Toast.tsx,
  state/preferences.ts, main.tsx, styles/base.css, components/Splash.css, screens/HomeScreen.css,
  screens/OnlineScreen.css, scene/useSceneHost.ts, scene/perfProbe.ts, scene/perfProbe.css, scene/perfReport.ts}` ;
  `public/_headers` (bloc `/assets/*`) ; `scripts/measure-scene.ts`, `scripts/measure-load.ts`, `package.json`
  (`@axe-core/playwright` 4.13.0, scripts de mesure) ; tests adaptés au focus rendu au déclencheur :
  `tests/e2e/local.spec.ts`, `tests/e2e/setup.spec.ts` ; docs : D46, TESTING « Depuis PFC-021 », ARCHITECTURE
  « Rendu et qualité », TRACEABILITY, `tasks/README.md`, nouveau `tasks/PFC-027-compilation-shaders.md`.
- Blocages / décisions nouvelles : D46 (proposé par défaut, sauf mesure téléphone par la sonde : choix du propriétaire
  du 2026-09-29). Mesure sur téléphone réel d'abord reportée à PFC-022, puis relevée par le
  propriétaire le jour même (sonde `?perf`, captures du panneau) et consignée dans D46 et ARCHITECTURE. Écarts de la maquette conservés (contraste du raccourci pulsé de l'accueil,
  texte sur la scène 3D) : D46. Limites : lecteurs d'écran en mode navigation susceptibles d'intercepter A/S/D/J/K/L
  en local (en ligne : boutons) ; Échap quitte l'arène sans confirmation (comportement existant) ; le contraste est
  mesuré sur le rendu Chromium de référence. Prochain ticket disponible : PFC-025 ou PFC-026 (PFC-022 dépend de
  PFC-021).
