# PFC-006 — Cycle local et fenêtre de choix

- Statut : done
- Priorité : P1
- Lot : M1
- Dépendances : PFC-003, PFC-005

## Contexte et objectif
Orchestrer des manches complètes sans dépendre de la vitesse du rendu.

## Périmètre
Contrôleur local, machine à états, temps injecté, fenêtre de choix de 5 s, révélation et résultat. Exclut effets Three.js et mode tour par tour mobile (PFC-025).

## Règles et contraintes
SPEC cycle, R11/R12 ; D08/D09/D27 ; la fenêtre de 5 s va toujours jusqu'à zéro, même après deux choix ; transitions idempotentes.
Acquis de PFC-005 (D30) : phase `selecting` et verrous (`state/game.ts`, `lockChoice`), écoute clavier `useLocalKeys`.
Afficher le minuteur de la maquette et retirer son masque (`TIMER_MASK`, `tests/e2e/support.ts`) des états `select-*`.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| la sélection démarre à t=0 et les deux choix sont verrouillés à t=1000 ms | l’horloge atteint t=5000 ms | les choix sont révélés et une seule résolution est appliquée |
| seul J1 a choisi feu à t=0 | l’horloge atteint t=5000 ms | J1 marque 1 point (R11) et la manche suivante commence si la partie continue |

## Critères d'acceptation
- [x] AC1 : Aucune révélation avant t=5000 ms, même avec deux choix ; à l'échéance, révélation et résolution exactement une fois, y compris choix unique (R11) ou manche vide (R12).
- [x] AC2 : Aucune saisie hors sélection ; après le résultat (D09) une nouvelle sélection vide commence si la partie n'est pas terminée.
- [x] AC3 : Démontage/StrictMode/onglet masqué ne dupliquent pas résolution ou callbacks.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Cycle local et fenêtre de choix
  Scénario: PFC-006-S1 — Révélation à échéance
    Étant donné la sélection démarre à t=0 et les deux choix sont verrouillés à t=1000 ms
    Quand l’horloge atteint t=5000 ms
    Alors les choix sont révélés et une seule résolution est appliquée
  Scénario: PFC-006-S2 — Choix unique
    Étant donné seul J1 a choisi feu à t=0
    Quand l’horloge atteint t=5000 ms
    Alors J1 marque 1 point (R11) et la manche suivante commence si la partie continue
```

## Tests et vérification
Vitest horloge injectée : t=4999, 5000, choix unique, aucun choix, callbacks répétés ; intégration React sous StrictMode.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-006-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : terminée le 2026-09-28, sur `main`, sans commit (non demandé). Aucune session paire active
  (ListAgents, avant et après le travail).
- Arbitrage du propriétaire (2026-09-28) : écran « Fin de partie » de la maquette livré maintenant ; « Rejouer »
  et Espace annoncent la revanche de PFC-007.
- Remise en question du ticket (appliquée, tracée dans D09, D31, SPEC, ARCHITECTURE et TESTING) :
  - Machine à états pure à horloge injectée. Chaque phase porte son échéance ; `tick` est idempotent ; une seule
    minuterie. Les deux `setTimeout` de PFC-005 disparaissent.
  - Résolution unique à l'échéance ; les scores d'avant sont affichés jusqu'à l'impact (maquette).
  - Retard (onglet masqué) sans rattrapage en rafale, et `tick` au retour de visibilité.
  - Téléphone : la partie attend avant la sélection. Sinon, des manches vides s'enchaîneraient sans saisie possible.
  - Minuteur de la maquette mis à jour dans le DOM toutes les 50 ms, sans rendu React par pas. Masque retiré.
- Défauts trouvés et corrigés en chemin :
  1. **Minuterie en avance** : un navigateur peut déclencher `setTimeout` avant l'échéance mesurée par
     `performance.now()`. Le `tick` était alors ignoré et la partie restait bloquée (mesuré en E2E, temps réel).
     La minuterie se réarme désormais tant que l'échéance n'est pas atteinte. Un test unitaire le prouve :
     l'ancien code échoue.
  2. **Course de planification** : les minuteries posées par `useEffect` pouvaient l'être après l'observation du
     rendu (échec intermittent sous WebKit). Elles sont maintenant posées dans le commit (`useLayoutEffect`), et
     les tests avancent l'horloge phase par phase.
  3. **Tiroir Réglages** : le glissement de 32 px sortait l'interrupteur de l'écran pendant l'animation, et un
     clic ou un focus précoce faisait défiler le panneau (1 échec sur 445). Glissement ramené à 24 px, sous la
     marge de 28 px.
  4. Mutation survivante : la condition `!drawEnabled` de la mort subite était redondante et a été supprimée.
     Les tests de frontière manquants (or à 1,5 s, mention « score minimum : 0 ») ont été ajoutés.
- Commandes exécutées / résultats (Node 24.21.0) :
  - `npm run verify` : exit 0.
    - Build ✓.
    - `test:functional` : 249/249 (domaine 132, client 117).
    - Lint : 0 warning.
    - E2E : 89/89 (Chromium, Firefox, WebKit), dont 26 comparaisons visuelles à tolérance nulle, sans masque.
  - `npx playwright test --repeat-each=5` : 445/445. Visuel seul `--repeat-each=10` : 260/260.
  - `npm run baseline:mockup` exécuté deux fois : 26 références identiques au bit près.
  - Mutations :
    - 14 appliquées d'abord ; 3 survivantes traitées (suppression de code redondant, ajout de tests).
    - 4 réappliquées ensuite, toutes tuées.
    - L'ancien code de minuterie sans réarmement est tué par le nouveau test.
    - Sauvegardes vérifiées et restaurations contrôlées par `cmp`. Une sauvegarde a échoué une fois (dossier
      temporaire disparu) : le fichier a été restauré à la main, puis vérifié par les tests.
  - `npm run dev` : une partie jusqu'à la fin, jouée dans Chromium, Firefox et WebKit, sans erreur ni
    avertissement en console.
- Preuves / fichiers :
  - Client :
    - `src/client/state/{game,clock,useCycle}.ts`, `src/client/copy.ts`, `src/client/Stage.tsx`, `src/client/App.tsx` ;
    - `src/client/screens/{Arena,RoundTimer,EndScreen}.{tsx,css}`, `src/client/screens/SettingsDrawer.css`.
  - Tests :
    - `tests/unit/client/{game,copy}.test.ts`, `tests/unit/client/{Stage,useCycle}.test.tsx` ;
    - `tests/e2e/{cycle,keyboard,setup}.spec.ts`, `tests/e2e/support.ts` ;
    - 7 nouvelles références ; `select-*` recapturées sans masque.
  - Outillage : `scripts/capture-mockup-baseline.ts` (le moteur bouchonné déclenche `clash`).
  - Documentation :
    - `docs/{SPEC,DECISIONS,ARCHITECTURE,TESTING,TRACEABILITY}.md` ;
    - `tasks/PFC-007-revanche-locale.md`, `tasks/PFC-008-scene-three.md`, `tasks/README.md`.
- Blocages / décisions nouvelles et limites :
  - D31 et la nouvelle version de D09 sont proposées par défaut, sur arbitrage du propriétaire pour l'écran de fin.
  - Les trophées sont réglés, mais pas encore affichés (maquette sans trophées ; SPEC : PFC-007).
  - Les skills `/design-taste-frontend`, `/web-design-guidelines` et `/playwright-cli` ne sont pas installés.
    Leurs principes ont été appliqués à la main, avec `@playwright/test`.
  - Prochains tickets prêts : PFC-007 (revanche locale) et PFC-010 (protocole).
