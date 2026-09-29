# PFC-022 — CI reproductible et déploiement staging Cloudflare

- Statut : todo
- Priorité : P0
- Lot : M3
- Dépendances : PFC-020, PFC-021

## Contexte et objectif
Créer une chaîne vérifiable de build à staging sans publier à chaque modification.

## Périmètre
CI du dépôt choisi, scripts release, secrets injectés, config staging/prod isolée, déploiement staging. Exclut production automatique.

## Règles et contraintes
TESTING ordre imposé ; Static Assets + DO ; migrations explicites ; accès Cloudflare requis seulement pour publier.
Références : [SPEC](../docs/SPEC.md), [décisions](../docs/DECISIONS.md),
[architecture](../docs/ARCHITECTURE.md), [protocole](../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| un test fonctionnel échoue en CI | la pipeline exécute les gates | aucun déploiement n’est lancé |
| l’artefact a passé verify et les secrets staging sont disponibles | le déploiement staging est demandé | deux clients peuvent créer rejoindre et terminer une partie en WSS |

## Critères d'acceptation
- [ ] AC1 : CI clean exécute npm ci, build, fonctionnel, ESLint et Playwright dans cet ordre avec arrêt en échec.
- [ ] AC2 : Staging sert SPA, API et WSS avec bonnes bindings ; aucun token livré au client.
- [ ] AC3 : Smoke deux joueurs/reconnexion passe sur staging ; rollback et compatibilité stockage documentés.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: CI reproductible et déploiement staging Cloudflare
  Scénario: PFC-022-S1 — Gate rouge
    Étant donné un test fonctionnel échoue en CI
    Quand la pipeline exécute les gates
    Alors aucun déploiement n’est lancé
  Scénario: PFC-022-S2 — Staging prêt
    Étant donné l’artefact a passé verify et les secrets staging sont disponibles
    Quand le déploiement staging est demandé
    Alors deux clients peuvent créer rejoindre et terminer une partie en WSS
```

## Tests et vérification
Pipeline et npm run verify local ; smoke réel staging, version publiée et preuve URL. Si secrets absents : ticket blocked, conserver config prête et contrôles locaux.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [ ] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [ ] Scénarios PFC-022-S1 et S2 traduits en tests appropriés et exécutés.
- [ ] [DoD commune](../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [ ] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [ ] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : non commencée.
- Commandes exécutées / résultats : aucune.
- Preuves / fichiers : à renseigner pendant le travail.
- Blocages / décisions nouvelles : aucun identifié ; dépendances à terminer avant démarrage.
