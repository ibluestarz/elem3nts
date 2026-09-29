# PFC-020 — Durcissement abus et observabilité

- Statut : todo
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
Références : [SPEC](../docs/SPEC.md), [décisions](../docs/DECISIONS.md),
[architecture](../docs/ARCHITECTURE.md), [protocole](../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| une IP a épuisé 10 tentatives dans la minute | elle tente de créer une room supplémentaire | la requête est limitée sans créer de room |
| un message malformé contenant un token est reçu | le serveur journalise le rejet | le log contient un code d’erreur sans token ni payload complet |

## Critères d'acceptation
- [ ] AC1 : Limites create/join et sockets mesurées, dépassement explicite sans affecter les autres joueurs légitimes.
- [ ] AC2 : Logs exploitables par room technique/match/revision sans données secrètes ; erreurs internes non divulguées.
- [ ] AC3 : Headers, Origin, taille et schémas testés ; choix de mécanisme rate limit et limites de l’offre Cloudflare documentés.

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
- [ ] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [ ] Scénarios PFC-020-S1 et S2 traduits en tests appropriés et exécutés.
- [ ] [DoD commune](../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [ ] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [ ] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : non commencée.
- Commandes exécutées / résultats : aucune.
- Preuves / fichiers : à renseigner pendant le travail.
- Blocages / décisions nouvelles : aucun identifié ; dépendances à terminer avant démarrage.
