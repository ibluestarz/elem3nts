# PFC-026 — Démo des confrontations

- Statut : todo
- Priorité : P1
- Lot : M1
- Dépendances : PFC-008

## Contexte et objectif
L'accueil de la maquette propose « Démo des confrontations » : l'arène rejoue à la demande chacune des neuf
confrontations avec son effet 3D et son explication. Depuis PFC-004, le bouton annonce « bientôt disponible »
par un toast (D29). PFC-008 livre la scène et les effets ; cet écran les rend consultables hors partie.

## Périmètre
Inclus : écran `demo` de la maquette (panneau « Démo · rejouer chaque confrontation », sélecteur « Vainqueur
À gauche / À droite », bouton « Accueil », neuf boutons), rejouées avec les mêmes échéances et le même pont de
scène que la partie ; Échap et « Accueil » ramènent à l'accueil ; repli DOM sans WebGL.
Exclus : toute session ou trophée (la démo ne compte rien), mode en ligne, nouvel effet visuel.

## Règles et contraintes
Maquette `runDemo` : scores 2/2 (1/3 ou 3/1 pour « écart »), choix imposés selon le côté vainqueur, révélation
puis effet, retour à l'état d'attente sans manche suivante ; boutons à opacité 0,4 pendant un effet et inactifs.
Les textes et deltas viennent de `resolveRound` (D25) ; la scène ne calcule rien (ARCHITECTURE, D33).
Références : [SPEC](../docs/SPEC.md), [décisions](../docs/DECISIONS.md), [architecture](../docs/ARCHITECTURE.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| démo, vainqueur à gauche | « Eau + Eau » | révélation eau/eau, effet siphon, bannière « Eau + Eau · Le reflux emporte tout — −1 pour chacun », 2/2 → 1/1 |
| un effet en cours | clic sur une autre confrontation | ignoré, boutons atténués jusqu'à la fin de l'effet |

## Critères d'acceptation
- [ ] AC1 : les neuf confrontations se rejouent avec l'explication et les deltas du moteur pur, des deux côtés.
- [ ] AC2 : aucune manche suivante, aucun trophée, aucun score de session modifié ; Échap revient à l'accueil.
- [ ] AC3 : rendu DOM identique à la maquette (D28) au repos et pendant un effet.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Démo des confrontations
  Scénario: PFC-026-S1 — Double eau rejouée
    Étant donné l'écran de démo avec le vainqueur à gauche
    Quand « Eau + Eau » est choisi
    Alors l'effet siphon et le texte de perte de point apparaissent puis la démo revient au repos
  Scénario: PFC-026-S2 — Effet en cours
    Étant donné une confrontation en cours de démonstration
    Quand une autre confrontation est choisie
    Alors elle est ignorée
```

## Tests et vérification
Vitest (état de démo, garde pendant un effet) ; Playwright parité visuelle Chromium et parcours clavier 3 moteurs.

## Definition of Done
- [ ] DoD commune de docs/TESTING.md satisfaite pour ce périmètre.
- [ ] D29 mis à jour : le bouton ouvre la démo.
- [ ] Suivi et dépendances mis à jour.

## Suivi
- Implémentation : non commencée.
- Commandes exécutées / résultats : aucune.
- Preuves / fichiers : à renseigner pendant le travail.
- Blocages / décisions nouvelles : créé pendant PFC-008 (2026-09-28), D29 le rattachait à PFC-008 hors de son périmètre.
