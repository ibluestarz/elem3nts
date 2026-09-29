# PFC-020 — Durcissement abus et observabilité

- Statut : done
- Priorité : P0
- Lot : M3
- Dépendances : PFC-019

## Contexte et objectif
Exposer le jeu public avec des limites et diagnostics proportionnés.

## Périmètre
Rate limiting partagé create/join/upgrade, budgets sockets, logs structurés, headers sécurité et runbook. Exclut analytics tiers et comptes.

## Règles et contraintes
PROTOCOL quotas ; aucun compteur global Worker ; aucun token/log de choix caché ; CSP compatible scène et sockets même origine.
Journalisation : ESLint interdit `console` dans `src/worker/**` depuis PFC-011 ; introduire un logger structuré (allowlist de champs) plutôt que lever la règle.
Depuis PFC-012 (D36) : `POST /api/rooms` et `/join` n'ont ni limite de débit (`RATE_LIMITED` à ajouter ici) ni contrôle
`Origin`/`Sec-Fetch-Site` : un site tiers peut déclencher des créations (réponse illisible par CORS, mais coût).
Depuis PFC-013 (D37) : Origin des upgrades vérifiée (403 `ORIGIN_FORBIDDEN`, origine exacte de la requête) et limites
par connexion livrées (4 KiB, 20/s rafale 30, 4429 au 3e dépassement). Restent ici : limite partagée des upgrades,
nombre maximal de sockets (en attente comprises) par room, et journalisation des fermetures sans token.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| une IP a épuisé 10 tentatives dans la minute | elle tente de créer une room supplémentaire | la requête est limitée sans créer de room |
| un message malformé contenant un token est reçu | le serveur journalise le rejet | le log contient un code d’erreur sans token ni payload complet |

## Critères d'acceptation
- [x] AC1 : Limites create/join et sockets mesurées, dépassement explicite sans affecter les autres joueurs légitimes.
- [x] AC2 : Logs exploitables par room technique/match/revision sans données secrètes ; erreurs internes non divulguées.
- [x] AC3 : Headers, Origin, taille et schémas testés ; choix de mécanisme rate limit et limites de l’offre Cloudflare documentés.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Durcissement abus et observabilité
  Scénario: PFC-020-S1 — Abus de création
    Étant donné une IP a épuisé 10 tentatives dans la minute
    Quand elle tente de créer une room supplémentaire
    Alors la requête est limitée sans créer de room
  Scénario: PFC-020-S2 — Log erreur
    Étant donné un message malformé contenant un token est reçu
    Quand le serveur journalise le rejet
    Alors le log contient un code d’erreur sans token ni payload complet
```

## Tests et vérification
Tests intégration quota atomique, limites et audit des logs ; vérifier configurations et absence de secrets dans bundles/artefacts.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-020-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : terminée le 2026-09-29 (D45). Choix revus par rapport au ticket et au protocole :
  - limiteur = **Durable Object `Limiter` par IP** (fenêtre glissante exacte, décision sans `await`), et non le binding
    Rate Limiting, par emplacement et « permissif » : incompatible avec « quota atomique » et un S1 déterministe ;
  - deux budgets par IP : `entry` (create + join communs, 10/60 s) et `socket` (upgrades, 60/60 s) ; refus non comptés ;
    IPv6 par /64 ; adresse illisible → budget commun ; IP jamais journalisée ;
  - Fetch Metadata sur create/join (`Origin`/`Sec-Fetch-Site`) **avant** la limite, pour qu'un site tiers ne puisse pas
    épuiser le budget de sa victime ; en-têtes absents admis ;
  - plafond de **2 sockets en attente par room par éviction de la plus ancienne (4408)** plutôt que refus de la
    nouvelle : un porteur du code ne peut pas occuper la room ; sockets de joueurs jamais touchées ;
  - journal structuré `log.ts` (allowlist vérifiée à la compilation, room = identifiant du Durable Object, jamais le
    code ; ni `requestId`, token, empreinte, charge, choix, IP, message d'erreur) et événements de transition
    (`room.advanced`, `seat.absent`, `phase` sur chaque événement) pour suivre une room par révision ; Workers Logs activé ;
  - CSP stricte `'self'` et en-têtes de sécurité (`public/_headers`, réponses JSON) ; message « Trop de tentatives… »
    dans les surfaces d'erreur existantes (notification à la création, erreur du formulaire à la jonction), aucun écran
    de la maquette modifié ;
  - runbook d'exploitation `docs/RUNBOOK.md` (événements, incidents, réglages, offre Cloudflare sourcée).
- Commandes exécutées / résultats :
  - `npm run verify` (build + typecheck, fonctionnel, ESLint, Playwright 3 navigateurs) : **vert**, 773 tests
    fonctionnels (49 fichiers), 236 E2E contre le build servi par workerd, `EXIT 0`. Le premier passage avait 3 échecs
    dans `scene.spec.ts` : l'outillage de test injectait un `<style>` inline et chargeait des images `data:` dans la page,
    bloqués par la nouvelle CSP ; corrigé côté outillage (feuille construite, page vierge), jamais `bypassCSP`.
  - `npx vitest run --project worker` : 282 tests (dont `abuse.test.ts` 16, `rate.test.ts` 30).
  - `npx playwright test tests/e2e/security.spec.ts` : 21 tests (7 × 3 navigateurs).
  - Vérifications manuelles (preview workerd + script Playwright ; `playwright-cli` absent de l'environnement) :
    en-têtes sur `/`, `/p/:code`, fichiers et icône ; lobby à deux contextes sous CSP sans erreur dans les 3 navigateurs ;
    `CF-Connecting-IP` des contextes transmis à l'upgrade WebSocket dans les 3 navigateurs.
  - 6 mutations contrôlées, toutes détectées puis restaurées (docs/TESTING.md « Depuis PFC-020 »).
- Preuves / fichiers : `src/worker/{rate,limiter,log}.ts`, `entry.ts`, `index.ts`, `http.ts`, `room.ts`, `env.ts` ;
  `src/shared/protocol/socket.ts` ; `public/_headers` ; `wrangler.jsonc` (liaison `LIMITER`, migration `v2`,
  `observability`) ; client `online/api.ts`, `online/messages.ts` ; tests `tests/integration/{abuse,rate,config}.test.ts`,
  harnais (`Limiter` sur horloge figée, adresse cliente par requête), `tests/e2e/security.spec.ts`, `isolatedContext` ;
  docs DECISIONS D45, PROTOCOL, ARCHITECTURE, TESTING, TRACEABILITY, SOURCES, RUNBOOK, README.
- Blocages / décisions nouvelles : aucun blocage. Limites assumées (D45, RUNBOOK) : budget partagé derrière une même IP
  (NAT, CGNAT) ; aucune protection volumétrique (règles de zone Cloudflare, hors dépôt) ; `limiter.unavailable`
  (requête admise) non provoqué en test ; journaux vérifiés sur workerd local, Workers Logs à constater au staging
  (PFC-022) ; chiffres de l'offre Cloudflare relevés le 2026-09-29, à revérifier avant production.
