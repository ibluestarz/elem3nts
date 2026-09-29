# PFC-021 — Accessibilité et performance de la version complète

- Statut : todo
- Priorité : P1
- Lot : M3
- Dépendances : PFC-009, PFC-019

## Contexte et objectif
Conserver une expérience lisible et réactive dans les deux modes.

## Périmètre
Parcours clavier, annonces, responsive, contrastes, reduced-motion, GPU et bundles. Exclut refonte graphique hors besoins mesurés.

## Règles et contraintes
SPEC saisie et ARCHITECTURE rendu ; ne pas dépendre de la seule couleur ; UX inchangée sans WebGL.
Depuis PFC-008 (D33) : seul le rendu logiciel a été mesuré (~1,1 s/image, repli « trop lent » déclenché) ;
mesurer sur vrai GPU (bureau et téléphone) le temps d'image par qualité et valider le seuil du chien de garde
(médiane de 20 images > 150 ms) ; le chunk `engine-*.js` pèse 541 kB (140 kB gzip), chargé pendant l'ouverture.
Références : [SPEC](../docs/SPEC.md), [décisions](../docs/DECISIONS.md),
[architecture](../docs/ARCHITECTURE.md), [protocole](../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| l’utilisateur n’utilise pas la souris | il configure puis joue et relance une partie | tous les contrôles restent accessibles avec focus visible |
| prefers-reduced-motion est activé | une révélation a lieu | le résultat est lisible sans animation intense |

## Critères d'acceptation
- [ ] AC1 : Parcours réalisables au clavier, focus restauré, scores/résultats accessibles ; contrôles mobiles en ligne utilisables.
- [ ] AC2 : Absence de WebGL ou reduced-motion ne bloque aucune action.
- [ ] AC3 : Mesures frame time et taille bundle documentées ; pas de fuite de listeners/GPU après 20 revanches ; optimisation guidée par mesure.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Accessibilité et performance de la version complète
  Scénario: PFC-021-S1 — Navigation clavier
    Étant donné l’utilisateur n’utilise pas la souris
    Quand il configure puis joue et relance une partie
    Alors tous les contrôles restent accessibles avec focus visible
  Scénario: PFC-021-S2 — Animations réduites
    Étant donné prefers-reduced-motion est activé
    Quand une révélation a lieu
    Alors le résultat est lisible sans animation intense
```

## Tests et vérification
Playwright clavier/petits viewports, audit a11y automatisé complété manuellement ; profilage machine/navigateur notés.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [ ] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [ ] Scénarios PFC-021-S1 et S2 traduits en tests appropriés et exécutés.
- [ ] [DoD commune](../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [ ] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [ ] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : non commencée.
- Commandes exécutées / résultats : aucune.
- Preuves / fichiers : à renseigner pendant le travail.
- Blocages / décisions nouvelles : aucun identifié ; dépendances à terminer avant démarrage.
