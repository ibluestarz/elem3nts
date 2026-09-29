# PFC-001 — Socle TypeScript React Vite et commandes qualité

- Statut : done
- Priorité : P0
- Lot : M1
- Dépendances : aucune

## Contexte et objectif
Pouvoir démarrer et vérifier un socle reproductible avant toute logique de jeu.

## Périmètre
Initialisation npm, React/Vite/TS strict, ESLint, PostCSS Autoprefixer, Vitest, Playwright, scripts et lockfile. Exclut le moteur et les rooms.

## Règles et contraintes
ARCHITECTURE : un package ; conserver Browserslist exactement ; build.target explicite ; Node LTS compatible figé. Aucun faux test vide pour verdir les commandes.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| un clone propre avec la version Node documentée | npm ci puis npm run build sont exécutés | les bundles sont produits sans erreur de type |
| une erreur TypeScript volontaire dans un fichier compilé | le build est lancé | la commande échoue avec un code non nul |

## Critères d'acceptation
- [x] AC1 : Depuis un clone propre npm ci puis dev affiche une page française minimale sans erreur console.
- [x] AC2 : Build inclut typecheck ; un vrai test composant et un smoke Playwright existent ; les gates s’exécutent dans l’ordre de TESTING.
- [x] AC3 : Browserlist résolu, Autoprefixer actif et cible JS documentée ; aucune version flottante non verrouillée.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Socle TypeScript React Vite et commandes qualité
  Scénario: PFC-001-S1 — Installation propre
    Étant donné un clone propre avec la version Node documentée
    Quand npm ci puis npm run build sont exécutés
    Alors les bundles sont produits sans erreur de type
  Scénario: PFC-001-S2 — Échec de type
    Étant donné une erreur TypeScript volontaire dans un fichier compilé
    Quand le build est lancé
    Alors la commande échoue avec un code non nul
```

## Tests et vérification
Tests socle Vitest et smoke Playwright ; contrôle de la chaîne avec une erreur temporaire ensuite retirée. Documenter les commandes réellement disponibles.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-001-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : terminée le 2026-09-27, sur `main`, sans commit (non demandé).
  Page minimale = écran « loading » de la maquette `elem3nts-design/`, pixel pour pixel (D22).
- Remise en question du ticket (appliquée, tracée dans DECISIONS D21–D24 et ARCHITECTURE) :
  - `build.target` : le défaut Vite 8 exclurait Chrome 109, pourtant résolu par Browserslist.
    La cible explicite est vérifiée par un test qui échoue si la base caniuse dérive.
  - ESLint 9 n'est plus maintenu, et `eslint-plugin-jsx-a11y` bloque ESLint 10.
    Choix : ESLint 10 avec le fork `eslint-plugin-jsx-a11y-x`.
    TypeScript reste en 6.0 tant que typescript-eslint ne supporte pas la 7.
  - Polices auto-hébergées. @fontsource donnait un rendu différent de la maquette (8 pixels par capture).
    Les fichiers exacts de Google Fonts, auto-hébergés, donnent 0 pixel d'écart.
  - S2 automatisé : fixture compilée avec la vraie configuration `tsconfig.app.json`.
  - Parité visuelle automatisée contre des références capturées depuis la maquette elle-même.
    La tolérance est nulle.
  - Faux positif corrigé : `document.fonts.ready` et l'option `animations: 'disabled'` ne suffisent pas.
    Mesure : 2 captures sur 20 à opacité 0 ; attente réelle des animations ajoutée, 0 sur 20 ensuite.
  - Favicon SVG réel (évite une erreur 404 en console). `lang="fr"`, landmark `main`, `h1`, `role="status"`.
  - `prefers-reduced-motion` respecté. Jetons de design et de mouvement pour les transitions et notifications des tickets suivants.
- Commandes exécutées / résultats (WSL Ubuntu 22.04) :
  - S1 : copie propre de l'arbre (sans `node_modules` ni `dist`, fichiers non commités), `nvm use`,
    puis `npm ci` et `npm run build`.
    Résultat : exit 0 sur Node 24.21.0 / npm 11.19.0, 0 vulnérabilité. Exit 0 aussi sur Node 24.20.0.
    Hachages des bundles identiques à ceux du dépôt.
  - S2 manuel : ligne `export const erreurVolontaire: number = "trois";` ajoutée à `src/client/App.tsx`.
    `npm run build` affiche `error TS2322` et sort avec le code 2 ; `vite build` ne s'exécute pas.
    Fichier restauré, contrôlé identique par `diff`.
  - S2 automatisé : `tests/tooling/typecheck-gate.test.ts`, 2 tests (code non nul et témoin 0).
  - `npm run verify` (Node 24.21.0), exit 0 :
    - build ✓ ;
    - test:functional 10/10 ;
    - lint 0 erreur, 0 warning ;
    - test:e2e 8/8 (Chromium, Firefox, WebKit).
  - `npx playwright test --project=chromium tests/e2e/visual.spec.ts --repeat-each=10` : 20/20.
    Comparaison stricte hors Playwright : 0 canal différent sur 1 024 000 et 329 160 pixels.
  - `npm run dev` ouvert dans Chromium, Firefox et WebKit : page française affichée.
    Aucune erreur, aucun warning, aucune requête en échec ; seuls des messages debug/info Vite et React.
  - AC3 : `npx browserslist` résolu et consigné dans ARCHITECTURE.
    `-webkit-user-select` présent dans le CSS construit ; test PostCSS `-webkit-background-clip`.
    Aucune version non exacte dans `package.json` (vérifié par grep).
    Aucune requête Google Fonts dans le build.
- Preuves / fichiers :
  - Configuration : `package.json`, `package-lock.json`, `.nvmrc`, `.npmrc`, `.gitignore`, `tsconfig*.json`,
    `vite.config.ts`, `vitest.config.ts`, `postcss.config.js`, `eslint.config.js`, `playwright.config.ts`.
  - Application : `index.html`, `public/favicon.svg`,
    `src/client/{main,App}.tsx`, `src/client/components/{AppShell,Splash}.{tsx,css}`,
    `src/client/styles/{tokens,base}.css`, `src/client/assets/fonts/` (37 woff2, `fonts.css`, `OFL.txt`).
  - Tests : `tests/setup.ts`, `tests/unit/client/App.test.tsx`, `tests/tooling/*`,
    `tests/e2e/{smoke,visual}.spec.ts`, `tests/e2e/support.ts`, `tests/e2e/__screenshots__/`.
  - Outil : `scripts/capture-mockup-baseline.ts`.
  - Documentation : `docs/{ARCHITECTURE,DECISIONS,TESTING,TRACEABILITY}.md`, `CLAUDE.md`, `tasks/README.md`.
- Blocages / décisions nouvelles :
  - Écarts connus au contrat de TESTING, faute de Worker : `dev`, `build` et `test:e2e` couvrent le front seul.
    PFC-011 les complètera. Scripts `deploy:*` : PFC-022/023.
  - Les skills `/design-taste-frontend`, `/web-design-guidelines` et `/playwright-cli` n'étaient pas
    installés dans cet environnement. Leurs principes ont été appliqués manuellement, et `@playwright/test` a été utilisé.
  - Prochains tickets prêts : PFC-002 (moteur) et PFC-004 (accueil et réglages).
