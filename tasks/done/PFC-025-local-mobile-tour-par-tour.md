# PFC-025 — Local mobile tour par tour

- Statut : done
- Priorité : P1
- Lot : M1
- Dépendances : PFC-006

## Contexte et objectif
Permettre une partie locale sur un seul téléphone, comme dans la maquette, sans clavier partagé.

## Périmètre
Inclus : phase « voile » entre les joueurs, 5 s de choix pour J1 puis pour J2, boutons tactiles des trois éléments,
révélation déclenchée par le choix ou l'échéance de J2, textes de la maquette (« Joueur 1, à vous », « Passez le
téléphone à Joueur 2 », « Je suis prêt »).
Exclus : mode en ligne, scène 3D (PFC-008), anti-triche physique.

## Règles et contraintes
SPEC « Cycle de manche » (paragraphe téléphone), R11/R12, D19, D27. Mode actif quand la scène fait moins de 720 px de large.
Le choix de J1 reste caché sous le voile ; aucun élément n'est affiché avant la révélation.
Depuis PFC-005 : sur téléphone, le clavier ne sélectionne pas et l'indice « Le mode tour par tour arrive bientôt. »
occupe l'emplacement `mobHint` de la maquette ; le remplacer par le cycle tour par tour.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md), maquette `elem3nts-design/` (écran « gate »).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| manche 1 en mode téléphone, voile « Joueur 1, à vous » | J1 touche « Je suis prêt » puis Feu | le voile « Passez le téléphone à Joueur 2 » s'affiche sans montrer Feu |
| J1 n'a pas choisi en 5 s | J2 choisit Eau | la révélation applique R11 : +1 pour J2 |

## Critères d'acceptation
- [x] AC1 : Chaque joueur dispose de 5 s après son « Je suis prêt » ; le choix de J2 ou son échéance déclenche une seule révélation.
- [x] AC2 : Le choix de J1 n'est jamais présent dans le DOM avant la révélation ; textes et rendu identiques à la maquette.
- [x] AC3 : Passage bureau ↔ téléphone (redimensionnement) sans perte d'état ni double résolution.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Local mobile tour par tour
  Scénario: PFC-025-S1 — Passage de l'appareil
    Étant donné manche 1 en mode téléphone, voile « Joueur 1, à vous »
    Quand J1 touche « Je suis prêt » puis Feu
    Alors le voile « Passez le téléphone à Joueur 2 » s'affiche sans montrer Feu
  Scénario: PFC-025-S2 — J1 hors délai
    Étant donné J1 n'a pas choisi en 5 s
    Quand J2 choisit Eau
    Alors la révélation applique R11 : +1 pour J2
```

## Tests et vérification
Vitest contrôleur à horloge injectée ; Playwright 390×844 (3 moteurs) et parité visuelle avec l'écran « gate » de la maquette.

## Definition of Done
- [x] [DoD commune](../../docs/TESTING.md) satisfaite pour ce périmètre.
- [x] Scénarios PFC-025-S1 et S2 traduits en tests et exécutés.
- [x] Suivi et dépendances mis à jour.

## Suivi
- Implémentation : terminée (2026-09-29).
  - Reducer local (`src/client/state/game.ts`) : phase `gate`, champ `turn` (joueur du tour, `null` en simultané),
    actions `turn-ready` et `choose.now`, `tick.hotseat` ; le mode est fixé à l'ouverture de la manche (D47).
  - `src/client/screens/TurnGate.tsx/.css` : voile de la maquette (dialogue modal, focus sur son action, piège de
    focus) ; textes `turnGateCopy` (`copy.ts`) ; jeton `--color-veil`.
  - `src/client/components/ElementPicks.tsx/.css` : zones à toucher et repli sans 3D extraits d'`OnlineArena`
    (mêmes classes, rendu en ligne inchangé, vérifié au pixel) et réutilisés pour le tour par tour.
  - `Arena.tsx` : statuts « En attente », indice « Joueur N · touchez un élément », choix au toucher du seul joueur
    du tour, voile ; `Stage.tsx` : clavier réservé aux manches simultanées ; `sceneViewOf` : le voile reste une
    sélection pour la scène (verrou de J1 conservé).
- Commandes exécutées / résultats (Node v24.21.0) :
  - `npx vitest run tests/unit` : 500 passed (dont les cas PFC-025 du reducer et de `Stage`).
  - `npm run baseline:mockup -- --only turn-` : 4 références écrites depuis la maquette (aucune autre modifiée).
  - `npx playwright test visual.spec.ts --project=chromium -g "turn-|online-|select|arena-intro"` : 25 passed.
  - `npx playwright test turns.spec.ts` : 12 passed (3 navigateurs) ; `turns keyboard setup online` : passés après
    correction d'un sélecteur de test ; `a11y.spec.ts -g "tour par tour"` : 3 passed.
  - `npm run verify` : **EXIT 0** — build OK ; Vitest 50 fichiers, 792 tests passed ; ESLint 0 warning ;
    Playwright 288 passed, 18 skipped (14,3 min).
- Preuves / fichiers : `tests/unit/client/game.test.ts`, `tests/unit/client/Stage.test.tsx`, `tests/e2e/turns.spec.ts`,
  `tests/e2e/keyboard.spec.ts` (redimensionnement avant l'ouverture de la manche), `tests/e2e/support.ts` (états
  `turn-*`, `mobileOnly`), `tests/e2e/__screenshots__/visual.spec.ts/turn-*-390x844.png`, `tests/e2e/a11y.spec.ts` ;
  docs : D47 (et renvoi dans D30), TESTING « Depuis PFC-025 », TRACEABILITY.
- Blocages / décisions nouvelles : D47 (proposé par défaut pour le redimensionnement, le reste suit la maquette).
  Limites : un redimensionnement vers le téléphone pendant une manche simultanée la laisse simultanée (clavier
  seulement) jusqu'à la manche suivante ; anti-triche physique hors périmètre. Test sur téléphone réel : à faire
  par le propriétaire.
