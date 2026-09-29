# PFC-004 — Accueil règles et réglages validés

- Statut : done
- Priorité : P1
- Lot : M1
- Dépendances : PFC-001

## Contexte et objectif
Permettre aux joueurs de comprendre le jeu et choisir les paramètres avant le lancement.

## Périmètre
Écran accueil, règles visibles, paramètres X et nul, boutons modes ; contrat de settings partagé. Exclut connexion réelle.

## Règles et contraintes
SPEC réglages ; D07 X=3/nul ON ; uniquement entiers 1–10 ; ne pas arrondir silencieusement une saisie invalide.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| le formulaire avant partie | le joueur choisit X=10 et nul OFF | les réglages sont valides et affichés |
| le formulaire avant partie | le joueur saisit X=11 | le lancement reste indisponible et une erreur est affichée |

## Critères d'acceptation
- [x] AC1 : Les valeurs 1 et 10 sont acceptées ; 0, 11, vide, décimal et texte sont refusés avec erreur accessible.
- [x] AC2 : Mode et réglages accessibles au clavier ; libellés feu/eau/plante et effets identiques expliqués.
- [x] AC3 : Les réglages d’une partie en cours ne sont pas modifiables.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Accueil règles et réglages validés
  Scénario: PFC-004-S1 — Borne haute
    Étant donné le formulaire avant partie
    Quand le joueur choisit X=10 et nul OFF
    Alors les réglages sont valides et affichés
  Scénario: PFC-004-S2 — Valeur invalide
    Étant donné le formulaire avant partie
    Quand le joueur saisit X=11
    Alors le lancement reste indisponible et une erreur est affichée
```

## Tests et vérification
Testing Library formulaire et validation pure ; Playwright navigation/focus et bornes.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-004-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : terminée le 2026-09-28, sur `main`, sans commit (non demandé).
- Arbitrages du propriétaire (2026-09-28) :
  - adoption des règles de la maquette : PFC-024 (fait) et PFC-025 (créé) ;
  - X = 3 par défaut ;
  - tiroir Réglages complet ;
  - boutons vers des écrans futurs visibles, avec un toast.
- Remise en question du ticket (appliquée, tracée dans D27–D29, ARCHITECTURE et TESTING) :
  - La maquette ne propose qu'un sélecteur (−/+, pastilles) : impossible d'y saisir 11, et donc de
    prouver AC1. Le grand chiffre devient un champ transparent posé sur le texte de la maquette :
    rendu identique, saisie libre validée par `parseTargetInput`, sans arrondi.
  - Rendu identique au pixel près sur 14 états d'interface et 2 écrans d'ouverture (16 références),
    comparés à la maquette avec son moteur 3D bouchonné.
  - Deux causes d'instabilité trouvées et corrigées :
    - `clock.install()` seul laisse le temps s'écouler : `pauseAt` ajouté ;
    - le raster Chromium variait sous `backdrop-filter` : options de lancement déterministes.
  - Chargement paresseux de `Stage` abandonné. Sous WebKit, l'échec d'un import dynamique est mémorisé
    même après rechargement (mesuré). L'écran d'ouverture dure au moins 600 ms, puis attend les polices.
  - Contrat de réglages partagé dans le domaine (`src/domain/settings.ts`).
  - Garde « partie en cours » dans le reducer (AC3), en plus de la copie des réglages par `startMatch`.
- Commandes exécutées / résultats (Node 24.21.0, WSL Ubuntu 22.04) :
  - `npm run verify` : exit 0.
    - Build ✓.
    - `test:functional` : 190/190 (domaine 128, client 62).
    - Lint : 0 warning.
    - E2E : 46/46 (Chromium, Firefox, WebKit), dont 16 comparaisons visuelles à tolérance nulle.
  - `npx playwright test --repeat-each=5` : 230/230.
    Visuel seul `--repeat-each=5` : 80/80.
  - `npm run baseline:mockup` exécuté 4 fois : références identiques au bit près (empreintes md5).
    Référence de l'écran d'ouverture inchangée par rapport à PFC-001.
  - Mutations manuelles : 14 mutations de la logique client appliquées, 14 tuées.
    Mutations testées :
    - raccourci Espace sur un bouton ciblé ;
    - `repeat` ;
    - gel pendant la partie ;
    - lancement invalide ;
    - isolement de l'écoute de touche ;
    - annulation par Échap ;
    - dédoublonnage des toasts ;
    - `aria-invalid` et `aria-disabled` ;
    - focus sur la saisie fautive ;
    - Tab réservée ;
    - relecture du nul ;
    - restitution du focus.
    Sources restaurées, identiques par `diff`.
  - `npm run dev` parcouru dans Chromium, Firefox et WebKit : aucune erreur ni avertissement en console.
  - Revue visuelle des états hors maquette (focus clavier, erreur de X, toast, écoute et conflit de touche).
    Correction qui en a découlé : toasts déplacés en haut de l'écran, car ils masquaient « Commencer ».
- Preuves / fichiers :
  - Domaine : `src/domain/settings.ts` ; `src/domain/{match,index}.ts`.
  - Client :
    - `src/client/{App,Stage}.tsx`, `src/client/Stage.css`, `src/client/copy.ts` ;
    - `src/client/components/{Toast,toastContext,Switch,Keycap}.*`, `src/client/components/Splash.tsx` ;
    - `src/client/screens/{HomeScreen,SetupScreen,TargetStepper,RulesDialog,SettingsDrawer,ArenaIntro}.*`,
      `src/client/screens/panel.css` ;
    - `src/client/state/{game,preferences}.ts`, `src/client/input/keys.ts` ;
    - `src/client/hooks/{useCompact,useLayoutLabels,useFocusTrap}.ts` ;
    - `src/client/styles/{tokens,base}.css`.
  - Tests :
    - `tests/unit/client/{Stage.test.tsx,App.test.tsx,game,keys,preferences}.test.ts*` ;
    - `tests/unit/domain/settings.test.ts` ;
    - `tests/e2e/{setup,smoke,visual}.spec.ts`, `tests/e2e/support.ts`, `tests/e2e/__screenshots__/` (16 références).
  - Outillage : `scripts/capture-mockup-baseline.ts`, `playwright.config.ts`.
  - Documentation : `docs/{ARCHITECTURE,DECISIONS,TESTING,TRACEABILITY}.md`, `tasks/README.md`.
- Blocages / décisions nouvelles et limites :
  - D28 et D29 sont proposés par défaut ; D27 est une exigence du propriétaire.
  - Contraste : au repos, le raccourci « Appuyez sur Espace » est à opacité 0,5 (maquette), sous 4,5:1.
    Il pulse jusqu'à l'opacité 1 ; avec « Mouvements réduits », il reste à 1. À réévaluer en PFC-021.
  - « Notes de conception » n'a aucun ticket : décision produit à prendre (écran à créer ou lien à retirer).
  - Le choix d'affichage AZERTY/QWERTY sans Keyboard Layout API (SPEC saisie) relève de PFC-005.
    Ici : libellés appris à la réaffectation, et repli AZERTY.
  - Les skills `/design-taste-frontend`, `/web-design-guidelines` et `/playwright-cli` ne sont pas installés
    (`playwright-cli` introuvable). Leurs principes ont été appliqués à la main, avec `@playwright/test`.
  - Gates encore partiels (Worker : PFC-011) : inchangés depuis PFC-001.
  - Prochains tickets prêts : PFC-005 (clavier local) et PFC-010 (protocole).
