# PFC-011 — Worker local et stockage Durable Object

- Statut : done
- Priorité : P1
- Lot : M2
- Dépendances : PFC-001, PFC-010

## Contexte et objectif
Faire tourner le backend dans le runtime cible avec un état restaurable.

## Périmètre
Routeur Worker, binding/migration room DO SQLite, stockage versionné et serveur de dev intégré. Exclut règles de join et jeu en ligne.

## Règles et contraintes
ARCHITECTURE hébergement/atomicité ; API distincte du fallback SPA ; aucune autorité en global Worker.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| un état de room a été persisté | le Durable Object est reconstruit | la même revision et le même état sont restaurés |
| une requête vise /api/inconnue | le Worker traite la requête | il renvoie une erreur JSON 404 et non la page React |

## Critères d'acceptation
- [x] AC1 : API et SPA accessibles localement sur une origine ; route API inconnue répond JSON 404.
- [x] AC2 : État de room sauvegardé puis relu après reconstruction du DO ; schemaVersion prévu.
- [x] AC3 : Le build vérifie le Worker et la migration initiale sans déployer ; secrets exclus du dépôt.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Worker local et stockage Durable Object
  Scénario: PFC-011-S1 — Restauration
    Étant donné un état de room a été persisté
    Quand le Durable Object est reconstruit
    Alors la même revision et le même état sont restaurés
  Scénario: PFC-011-S2 — Route API absente
    Étant donné une requête vise /api/inconnue
    Quand le Worker traite la requête
    Alors il renvoie une erreur JSON 404 et non la page React
```

## Tests et vérification
Tests d’intégration dans runtime Workers local ; build/dry-run Wrangler ; rechargement de route SPA.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-011-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation (2026-09-28) :
  - `wrangler.jsonc` : Static Assets en mode SPA, `run_worker_first` = `/api`, `/api/*` ; liaison `ROOMS` → `Room` ;
    migration initiale `v1` (`new_sqlite_classes`) ; ni variable ni secret ; `send_metrics: false`.
  - `@cloudflare/vite-plugin` : dev (5173) et preview (4173) exécutent le Worker dans workerd, sur l'origine du front ;
    `npm run build` = `tsc -b && vite build && wrangler deploy --dry-run`.
  - `src/worker/` : routeur sans état global (`index.ts`), erreurs JSON à message fixe (`http.ts`), état v1 et
    garde complète (`codec.ts`, validateurs du contrat partagé réutilisés), `RoomStore` SQLite versionné
    (`storage.ts`), room Durable Object (`room.ts`), erreurs typées (`errors.ts`).
  - Contrat partagé : validateurs privés de `server.ts` déplacés dans `schema.ts` / `state.ts` et exportés, sans
    changement de comportement (48/48 tests du projet `protocol`).
  - Outillage : `tsconfig.worker.json` (types Workers), projet Vitest `worker`, garde ESLint `src/worker/**`
    (ni `let`/`var` de module, ni UI/Node, ni `console`), `.gitignore` (`.wrangler/`, `.dev.vars*`, `.env*`).
- Remises en question du ticket (D35) :
  - `@cloudflare/vitest-pool-workers` 0.22 exige Vitest 4 : pas de rétrogradation. Intégration dans le vrai runtime
    workerd via `createTestHarness` de wrangler 4.143.0, épinglé.
  - « Reconstruction » réelle : éviction du Durable Object (stockage conservé), puis relecture par le constructeur.
  - `schemaVersion` avec politique écrite : toute évolution de forme incrémente la version et ajoute une migration testée ;
    schéma plus récent (retour arrière) ou état altéré → échec fermé (503 `ROOM_UNAVAILABLE`, ligne intacte).
  - Écriture conditionnée à la révision persistée, strictement croissante, vérifiée dans la même transaction.
  - « Aucune autorité en global Worker » rendue vérifiable par ESLint ; format des erreurs HTTP ajouté à PROTOCOL.
  - `/api` sans barre finale ajouté à `run_worker_first` (sinon il servait la page React).
- Commandes exécutées / résultats :
  - `npm install -D wrangler@4.143.0 @cloudflare/vite-plugin@1.62.0 @cloudflare/workers-types@5.20260928.1` ;
    workerd 2026-09-26 fonctionnel malgré l'avertissement `install-scripts` (binaire en dépendance optionnelle).
  - `npx vitest run --project worker` : 35/35 (3 fichiers) ;
  - `npm run dev` + `curl` : `/api/inconnue` → 404 JSON ; `/salle/ABCD2345` et `/` → HTML, même origine (5173) ;
  - `vite preview` + `curl` : `/api`, `/api/`, `/api/inconnue` (GET, POST) → 404 JSON `no-store`/`nosniff` ;
    `/salle/ABCD2345` → 200 HTML ;
  - `npm ci && npm run verify` : EXIT 0. Build : bundle Worker validé à sec (`env.ROOMS (Room) Durable Object`) ;
    fonctionnel 372/372 (29 fichiers, projets domain, protocol, worker, client) ; lint 0 ; Playwright 131 réussis,
    12 ignorés (WebGL réservé à Chromium, existants : 122 + 9 nouveaux), parité visuelle intacte.
- Mutations contrôlées (toutes restaurées, identiques vérifiées par `diff`) :
  - constructeur sans relecture → 13 échecs (S1 et échec fermé) ;
  - contrôle de révision persistée neutralisé → 1 échec (écriture fondée sur une révision dépassée) ;
  - `run_worker_first` retiré → PFC-011-S2 E2E échoue (200, page React) ;
  - `Room` non exporté → le dry-run ne le détecte **pas** ; workerd refuse de démarrer en preview (E2E) et
    `config.test.ts` échoue : détecté par le gate.
- Preuves / fichiers : `tests/integration/{storage,router,config}.test.ts`, `tests/integration/harness/`,
  `tests/e2e/worker.spec.ts` ; docs : DECISIONS D35, ARCHITECTURE « Worker et stockage des rooms », PROTOCOL
  « Erreurs HTTP », TESTING (commandes et « Depuis PFC-011 »), TRACEABILITY, CLAUDE.md ; notes ajoutées à PFC-012
  (évolution du schéma) et PFC-020 (logger au lieu de `console`).
- Limites :
  - Static Assets applique le repli SPA à tout chemin absent hors `/api`, y compris un `/assets/*.js` inexistant
    (comportement Cloudflare avec `run_worker_first` en liste) ;
  - staging/production, bindings et secrets par environnement : PFC-022 ;
  - aucune route API ni création de room avant PFC-012 ;
  - `MIGRATIONS` vide en v1 : la première migration arrive avec son test.
- Blocages : aucun. Prochain ticket disponible : PFC-012 (création et réservation des rooms privées).
