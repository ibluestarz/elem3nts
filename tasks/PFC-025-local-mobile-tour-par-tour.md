# PFC-025 — Local mobile tour par tour

- Statut : todo
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
Références : [SPEC](../docs/SPEC.md), [décisions](../docs/DECISIONS.md), maquette `elem3nts-design/` (écran « gate »).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| manche 1 en mode téléphone, voile « Joueur 1, à vous » | J1 touche « Je suis prêt » puis Feu | le voile « Passez le téléphone à Joueur 2 » s'affiche sans montrer Feu |
| J1 n'a pas choisi en 5 s | J2 choisit Eau | la révélation applique R11 : +1 pour J2 |

## Critères d'acceptation
- [ ] AC1 : Chaque joueur dispose de 5 s après son « Je suis prêt » ; le choix de J2 ou son échéance déclenche une seule révélation.
- [ ] AC2 : Le choix de J1 n'est jamais présent dans le DOM avant la révélation ; textes et rendu identiques à la maquette.
- [ ] AC3 : Passage bureau ↔ téléphone (redimensionnement) sans perte d'état ni double résolution.

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
- [ ] [DoD commune](../docs/TESTING.md) satisfaite pour ce périmètre.
- [ ] Scénarios PFC-025-S1 et S2 traduits en tests et exécutés.
- [ ] Suivi et dépendances mis à jour.

## Suivi
- Implémentation : non commencée.
- Commandes exécutées / résultats : aucune.
- Preuves / fichiers : à renseigner pendant le travail.
- Blocages / décisions nouvelles : aucun identifié.
