# PFC-027 — Ouverture sans compilation bloquante des shaders

- Statut : todo
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
- [ ] AC1 : gain mesuré de l'accueil interactif à froid (médianes avant/après, même machine), consigné dans D46.
- [ ] AC2 : rendu 3D identique (tests de parité de `scene.spec.ts`), repli et chien de garde inchangés.

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
- [ ] DoD commune de docs/TESTING.md satisfaite pour ce périmètre.
- [ ] Mesures avant/après consignées (D46, ARCHITECTURE « Rendu et qualité »).
- [ ] Suivi et dépendances mis à jour.

## Suivi
- Implémentation : non commencée.
- Commandes exécutées / résultats : aucune.
- Preuves / fichiers : à renseigner pendant le travail.
- Blocages / décisions nouvelles : aucun identifié.
