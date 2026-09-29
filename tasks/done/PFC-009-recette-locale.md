# PFC-009 — Recette locale Playwright multi-navigateurs

- Statut : done
- Priorité : P1
- Lot : M1
- Dépendances : PFC-007, PFC-008

## Contexte et objectif
Prouver le parcours local complet avant de construire le réseau.

## Périmètre
Suite E2E local Chromium/Firefox/WebKit, cas limites et artefacts d’échec. Exclut mocks réseau en guise de preuve en ligne.

## Règles et contraintes
TESTING ; vrais raccourcis, attentes sur état observable ; tests isolés, aucun sleep arbitraire.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| X=1 et nul OFF en local | J1 choisit feu et J2 plante | J1 gagne et la revanche garde son trophée |
| X=1 et nul OFF avec scores 0/0 | les deux joueurs choisissent feu | la partie continue à 1/1 sans trophée attribué |

## Critères d'acceptation
- [x] AC1 : Parcours réglages → Espace → choix → révélation → victoire/nul → revanche couvert.
- [x] AC2 : Bornes X=1/10, nul OFF, trophées et focus clavier couverts.
- [x] AC3 : Suite tourne sur build production ; rapport identifie navigateur, scénario et trace en cas d’échec.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Recette locale Playwright multi-navigateurs
  Scénario: PFC-009-S1 — Partie minimale
    Étant donné X=1 et nul OFF en local
    Quand J1 choisit feu et J2 plante
    Alors J1 gagne et la revanche garde son trophée
  Scénario: PFC-009-S2 — Nul désactivé
    Étant donné X=1 et nul OFF avec scores 0/0
    Quand les deux joueurs choisissent feu
    Alors la partie continue à 1/1 sans trophée attribué
```

## Tests et vérification
npm run verify pour les suites disponibles ; vérifier les trois projets Playwright et fournir les résultats réels.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-009-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : terminée (2026-09-28). Ticket de recette : aucun changement de `src/`, aucun défaut produit trouvé.
  - `tests/e2e/local.spec.ts` (nouveau, 3 navigateurs, moteur 3D bouchonné (D33), horloge figée, vrai clavier) :
    PFC-009-S1 / AC1 (clavier seul : Espace → X = 1 par Début → Réglages nul OFF → Espace → choix → révélation →
    victoire J1 → revanche Espace → mort subite → victoire J2, trophées 1/1, focus vérifié à chaque écran) ;
    PFC-009-S2 (1/1, bannière « Mort subite », ni fin ni trophées, puis Feu/Eau → 1/2, un seul trophée 0/1,
    Tab Rejouer → Retour à l'accueil) ; PFC-009-AC2 X = 10 nul OFF (exemple SPEC 9/9 → 10/10 mort subite → 11/10) ;
    PFC-009-AC2 frappe tardive ignorée ; PFC-009-AC3 garde build de production.
  - `tests/e2e/local-driver.ts` (nouveau) : pilote partagé `toSelection` / `playRound` ; `tests/e2e/rematch.spec.ts`
    l'utilise à la place de sa copie locale (mêmes assertions, plus « pas de fin avant la fermeture »).
  - Challenge du ticket appliqué : S2 prolongé jusqu'à la résolution (trophée unique), S1 vérifie que la revanche
    garde nul OFF, X = 10 joué réellement, frappe tardive, garde contre un preview/serveur de dev réutilisé.
- Commandes exécutées / résultats (Node v24.21.0) :
  - `npx playwright test tests/e2e/local.spec.ts tests/e2e/rematch.spec.ts` : 24 passed (3 navigateurs).
  - `npx playwright test tests/e2e/local.spec.ts --repeat-each=5` : 75 passed, 0 flaky.
  - Mutation `src/domain/match.ts` (nul OFF traité comme nul ON), `vite build`, S2 et X = 10 sous Chromium :
    2 failed (attendu « Mort subite », reçu vide), fichier restauré (cmp identique), `dist/` reconstruit par verify.
  - Preuve AC3 (config temporaire contre `vite` port 5173, supprimée) : PFC-009-AC3 échoue sur chromium, firefox,
    webkit ; rapport list `[navigateur] › local.spec.ts › PFC-009-AC3 …`, `test-results/<test>-<navigateur>/trace.zip`,
    `error-context.md`, capture (firefox, webkit ; chromium : capture dans la trace), rapport HTML généré.
  - `npm run verify` : EXIT 0 — build OK ; Vitest 22 fichiers, 289 tests passed ; ESLint 0 warning ;
    Playwright 122 passed, 12 skipped (tests WebGL réservés à Chromium dans `scene.spec.ts`, existants) ;
    chromium 62, firefox 30, webkit 30 passés.
- Preuves / fichiers : `tests/e2e/local.spec.ts`, `tests/e2e/local-driver.ts`, `tests/e2e/rematch.spec.ts`,
  `docs/TESTING.md` (section « Depuis PFC-009 »), `docs/TRACEABILITY.md` (ligne PFC-009), `tasks/README.md`.
- Blocages / décisions nouvelles : aucune décision nouvelle. Limites : pas de Worker local avant PFC-011 (build +
  `vite preview`) ; 3D bouchonnée en E2E (D33), la 3D réelle reste couverte par `scene.spec.ts` (Chromium) ;
  en local, `reuseExistingServer` peut réutiliser un preview périmé sur 4173 — la garde AC3 détecte un serveur de
  dev, pas un `dist/` ancien : arrêter tout preview avant la recette (documenté dans TESTING.md).
  Prochain ticket disponible : PFC-010 (déjà en cours dans la session elem3nts-89), puis PFC-025 / PFC-026.
