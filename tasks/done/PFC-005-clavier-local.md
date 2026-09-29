# PFC-005 — Contrôles clavier locaux et choix masqués

- Statut : done
- Priorité : P1
- Lot : M1
- Dépendances : PFC-002, PFC-004

## Contexte et objectif
Jouer à deux sur le même clavier sans révéler les choix prématurément.

## Périmètre
Gestionnaire de saisie et disponibilité des joueurs, premier choix verrouillé, libellés AZERTY/QWERTY. Exclut timers et scène 3D.

## Règles et contraintes
SPEC saisie ; D10 codes physiques ; chaque action fonctionne séparément sans accord ; aucun élément affiché avant révélation.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| la phase selecting sans aucun choix | J1 presse KeyA puis J2 presse KeyL | feu et plante sont verrouillés et seuls les indicateurs prêt sont visibles |
| J1 a verrouillé feu | J1 presse KeyS | son choix reste feu et aucun élément adverse n’est affiché |

## Critères d'acceptation
- [x] AC1 : KeyA/S/D ciblent J1 et KeyJ/K/L ciblent J2 avec mapping feu/eau/plante.
- [x] AC2 : Une deuxième touche ne remplace pas le premier choix ; repeat et saisie dans un champ sont ignorés.
- [x] AC3 : Espace démarre une seule fois ; un bouton ciblé ne déclenche pas en plus le raccourci global ; listeners nettoyés.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Contrôles clavier locaux et choix masqués
  Scénario: PFC-005-S1 — Choix séparés
    Étant donné la phase selecting sans aucun choix
    Quand J1 presse KeyA puis J2 presse KeyL
    Alors feu et plante sont verrouillés et seuls les indicateurs prêt sont visibles
  Scénario: PFC-005-S2 — Choix irrévocable
    Étant donné J1 a verrouillé feu
    Quand J1 presse KeyS
    Alors son choix reste feu et aucun élément adverse n’est affiché
```

## Tests et vérification
Testing Library événements keydown/focus/repeat/démontage ; Playwright vrai clavier, disposition affichée et absence de noms d’éléments dans les zones de choix cachés.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-005-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : terminée le 2026-09-28, sur `main`, sans commit (non demandé).
- Arbitrages du propriétaire (2026-09-28) :
  - minuteur de la maquette masqué jusqu'à PFC-006 ; parité pixel sur tout le reste ;
  - choix AZERTY/QWERTY proposé sans Keyboard Layout API, en plus de l'apprentissage des libellés.
- Remise en question du ticket (appliquée, tracée dans D30, ARCHITECTURE et TESTING) :
  - Verrouillage du premier choix dans le domaine (`lockChoice`), réutilisable par le serveur (PFC-014).
  - Le choix n'est jamais rendu : il vit dans le reducer ; le HUD n'affiche que les statuts de la maquette,
    annoncés par joueur (`aria-live`).
  - Une lettre n'a pas d'action native : elle choisit même si un bouton a le focus. Seuls les champs, `repeat`
    et les modificateurs sont ignorés. `preventDefault` n'est appelé que pour une touche traitée.
  - Défaut de conception trouvé et corrigé : la sélection démarrait via un effet chaîné après un rendu.
    Désormais, les deux échéances de la maquette (1,8 s puis 2,2 s) sont planifiées ensemble, et l'écoute lit
    un indicateur synchrone : aucune frappe perdue ni anticipée.
  - Défaut réel trouvé : Chromium sans session graphique renvoie une table de disposition vide. Elle compte
    maintenant comme indisponible, et le choix AZERTY/QWERTY est alors proposé.
  - Simplification issue d'une mutation survivante : la phase de sélection s'ouvre aussi sur téléphone,
    seule l'écoute clavier y est désactivée. Le code de transition téléphone → bureau est supprimé.
- Commandes exécutées / résultats (Node 24.21.0) :
  - `npm run verify` : exit 0.
    - Build ✓.
    - `test:functional` : 221/221 (domaine 132, client 89).
    - Lint : 0 warning.
    - E2E : 73/73 (Chromium, Firefox, WebKit), dont 19 comparaisons visuelles à tolérance nulle.
  - `npx playwright test --repeat-each=5` : 365/365.
  - `npm run baseline:mockup` exécuté deux fois : 19 références identiques au bit près.
    Les 16 références existantes sont inchangées.
  - Mutations : 14 appliquées. 13 tuées d'emblée ; la survivante a conduit à la simplification ci-dessus.
    Mutations testées :
    - verrou de `lockChoice` ;
    - `repeat` ;
    - modificateurs ;
    - champs éditables ;
    - phase non ouverte ;
    - `preventDefault` ;
    - retrait de l'écouteur ;
    - apprentissage ;
    - garde de phase du reducer ;
    - statut hors sélection ;
    - délai de 0,4 s ;
    - table de disposition vide ;
    - repli QWERTY.
    Sources restaurées, identiques par `diff`.
  - `npm run dev` parcouru dans Chromium, Firefox et WebKit (sélection au clavier, réglage QWERTY) :
    aucune erreur ni avertissement en console.
- Preuves / fichiers :
  - Domaine : `src/domain/selection.ts`, `src/domain/index.ts`.
  - Client :
    - `src/client/input/useLocalKeys.ts`, `src/client/input/keys.ts` ;
    - `src/client/hooks/useLayoutLabels.ts` ;
    - `src/client/state/{game,preferences}.ts` ;
    - `src/client/Stage.tsx` ;
    - `src/client/screens/Arena.{tsx,css}` (ex-`ArenaIntro`), `src/client/screens/SettingsDrawer.{tsx,css}`.
  - Tests :
    - `tests/unit/domain/selection.test.ts` ;
    - `tests/unit/client/{game,keys,preferences}.test.ts`, `tests/unit/client/Stage.test.tsx` ;
    - `tests/e2e/keyboard.spec.ts`, `tests/e2e/support.ts`, `tests/e2e/visual.spec.ts` ;
    - 3 nouvelles références `select-*-1280x800.png`.
  - Outillage : `scripts/capture-mockup-baseline.ts` (masques, états réservés au bureau).
  - Documentation :
    - `docs/{ARCHITECTURE,DECISIONS,TESTING,TRACEABILITY}.md` ;
    - `tasks/PFC-006-cycle-local.md`, `tasks/PFC-025-local-mobile-tour-par-tour.md`, `tasks/README.md`.
- Blocages / décisions nouvelles et limites :
  - D30 est proposé par défaut, sur arbitrage du propriétaire.
  - Masque du minuteur à retirer par PFC-006 (consigné dans ce ticket).
  - Les skills `/design-taste-frontend`, `/web-design-guidelines` et `/playwright-cli` ne sont pas installés.
    Leurs principes ont été appliqués à la main, avec `@playwright/test`.
  - Prochains tickets prêts : PFC-006 (cycle local) et PFC-010 (protocole).
