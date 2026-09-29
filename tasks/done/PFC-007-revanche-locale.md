# PFC-007 — Fin de partie revanche et session locale

- Statut : done
- Priorité : P1
- Lot : M1
- Dépendances : PFC-006

## Contexte et objectif
Enchaîner plusieurs parties en gardant un bilan de victoires clair.

## Périmètre
Écrans résultat final, trophées, revanche Espace/bouton et fin de session. Exclut comptes et persistance entre rechargements.

## Règles et contraintes
SPEC session ; D12/D13 ; scores/choix remis à zéro à la revanche, réglages et trophées conservés.
Acquis de PFC-006 (D31) : écran « Fin de partie » de la maquette (`screens/EndScreen.tsx`), trophées réglés en
`ended` ; brancher « Rejouer » et Espace (aujourd'hui toast `REPLAY_SOON` dans `Stage.tsx`) et afficher les trophées.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| J1 a gagné et possède 2 trophées dans la session | Espace est pressé sur l’écran de fin | une nouvelle partie démarre à 0/0 avec les 2 trophées conservés |
| une session locale possède des trophées | les joueurs reviennent à l’accueil puis entrent en local | les trophées sont à 0/0 |

## Critères d'acceptation
- [x] AC1 : Les trois issues affichent le bon texte et les trophées exacts.
- [x] AC2 : Espace maintenu ne démarre pas plusieurs revanches ; matchId change une seule fois.
- [x] AC3 : Retour accueil puis nouveau local repart sans trophées ; rechargement clôt la session locale.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Fin de partie revanche et session locale
  Scénario: PFC-007-S1 — Revanche
    Étant donné J1 a gagné et possède 2 trophées dans la session
    Quand Espace est pressé sur l’écran de fin
    Alors une nouvelle partie démarre à 0/0 avec les 2 trophées conservés
  Scénario: PFC-007-S2 — Nouvelle session
    Étant donné une session locale possède des trophées
    Quand les joueurs reviennent à l’accueil puis entrent en local
    Alors les trophées sont à 0/0
```

## Tests et vérification
Vitest contrôleur et Playwright série de parties, nul ON, revanche et retour accueil.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-007-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : terminée le 2026-09-28, sur `main`, sans commit (non demandé). Aucune session paire active
  (ListAgents, avant et après le travail).
- Arbitrage du propriétaire (2026-09-28) : trophées affichés sur une ligne « Trophées de la session » sous les
  scores de fin. La maquette n'en montre aucun ; la parité pixel est conservée partout ailleurs (D32).
- Remise en question du ticket (appliquée, tracée dans D32, ARCHITECTURE et TESTING) :
  - Revanche dédiée (`rematch`) :
    - seulement depuis une partie terminée ;
    - reprend les réglages exacts de cette partie, et non la saisie courante ;
    - un second appui est sans effet (AC2 : matchId changé une seule fois).
  - Défaut évité : la session survivait à un retour à l'accueil. Entrer en mode local ouvre désormais une nouvelle
    session (`new-session`), ce qui satisfait AC3 et D13.
  - Parité visuelle : zone fixe exclue des deux côtés, avec contrôle de contenance. Ombre retirée de la ligne,
    et compteurs alignés sous les scores (écart de 1 px au plus, mesuré).
- Commandes exécutées / résultats (Node 24.21.0) :
  - `npm run verify` : exit 0.
    - Build ✓.
    - `test:functional` : 260/260 (domaine 132, client 128).
    - Lint : 0 warning.
    - E2E : 98/98 (Chromium, Firefox, WebKit), dont 26 comparaisons visuelles à tolérance nulle.
  - `npx playwright test --repeat-each=5` : 490/490.
  - `npm run baseline:mockup` exécuté deux fois : 26 références identiques. Seule `end` a changé, par sa zone exclue.
  - Mutations : 8 appliquées, 8 tuées.
    Mutations testées :
    - garde de fin sur la revanche ;
    - réglages repris de la partie ;
    - garde « partie en cours » ;
    - remise à zéro de la session ;
    - trophées du nul ;
    - `new-session` et `rematch` non déclenchés ;
    - « +1 » absent.
    Sauvegardes vérifiées par `cmp`.
  - `npm run dev` : deux parties avec revanche à l'Espace dans Chromium, Firefox et WebKit, sans erreur ni
    avertissement en console.
- Preuves / fichiers :
  - Client : `src/client/state/game.ts`, `src/client/Stage.tsx`, `src/client/screens/EndScreen.{tsx,css}`.
  - Tests :
    - `tests/unit/client/{game.test.ts,Stage.test.tsx}` ;
    - `tests/e2e/{rematch,cycle,visual}.spec.ts`, `tests/e2e/support.ts` ;
    - référence `end-1280x800.png`.
  - Outillage : `scripts/capture-mockup-baseline.ts` (zones fixes).
  - Documentation : `docs/{DECISIONS,ARCHITECTURE,TESTING,TRACEABILITY}.md`, `tasks/README.md`.
- Blocages / décisions nouvelles et limites :
  - D32 est proposé par défaut, sur arbitrage du propriétaire.
  - Textes de fin : ceux de la maquette (« Victoire », « Joueur N remporte la partie », « Match nul ») plutôt que
    « Joueur 1 a gagné » de la SPEC. Le rendu de la maquette fait foi.
  - Les skills `/design-taste-frontend`, `/web-design-guidelines` et `/playwright-cli` ne sont pas installés.
    Leurs principes ont été appliqués à la main.
  - Prochains tickets prêts : PFC-008 (scène Three.js) et PFC-010 (protocole).
