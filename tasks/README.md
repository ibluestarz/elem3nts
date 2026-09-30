# Backlog de développement

23 tickets initiaux, puis PFC-024 et PFC-025 (règles de la maquette, D27), PFC-026 (démo de la maquette, D29) et PFC-027 (optimisation mesurée en PFC-021, D46). Le champ **Statut dans chaque ticket** fait autorité ;
le tableau ci-dessous décrit l'ordre et les dépendances, sans recopier des statuts périssables.
P0 indique un invariant ou une porte de livraison critique ; P1 reste requis pour le MVP.
Le numéro donne un ordre conseillé ; seules les dépendances imposent l'ordre technique.

## Lots
- M1 / PFC-001 à 009 : jeu local complet avec effets, règles et recette.
- M2 / PFC-010 à 019 : mode en ligne, rooms, reprise et recette réseau.
- M3 / PFC-020 à 023 : sécurité, finition, CI, Cloudflare et livraison.

## Méthode
1. Lire le ticket et ses dépendances ; commencer par PFC-001.
2. `todo → in_progress → done` ; `blocked` si obstacle concret, avec cause et reprise indiquées.
3. Un seul ticket `in_progress` ; pas de statut done tant que la DoD obligatoire n'est pas prouvée.
   Un ticket `done` est déplacé dans `tasks/done/` (liens relatifs ajustés).
4. Les gates non encore implémentés ne sont pas des succès ; noter ce qui manque et son ticket.
5. Consigner commandes, résultats et fichiers dans Suivi ; laisser les critères non prouvés décochés.
6. Une évolution hors périmètre devient un ticket via `/create-ticket`, pas une extension silencieuse.
7. Consulter `docs/TRACEABILITY.md` pour la couverture des demandes initiales.

| ID | Résultat | Lot | Dépendances |
| --- | --- | --- | --- |
| [PFC-001](done/PFC-001-socle.md) | Socle TypeScript React Vite et commandes qualité | M1 | — |
| [PFC-002](done/PFC-002-moteur.md) | Moteur pur des neuf confrontations | M1 | PFC-001 |
| [PFC-003](done/PFC-003-victoire-trophees.md) | Victoire nul prolongation et trophées idempotents | M1 | PFC-002 |
| [PFC-004](done/PFC-004-reglages.md) | Accueil règles et réglages validés | M1 | PFC-001 |
| [PFC-005](done/PFC-005-clavier-local.md) | Contrôles clavier locaux et choix masqués | M1 | PFC-002, PFC-004 |
| [PFC-006](done/PFC-006-cycle-local.md) | Cycle local et fenêtre de choix | M1 | PFC-003, PFC-005 |
| [PFC-007](done/PFC-007-revanche-locale.md) | Fin de partie revanche et session locale | M1 | PFC-006 |
| [PFC-008](done/PFC-008-scene-three.md) | Arène Three.js et effets des éléments identiques | M1 | PFC-006, PFC-007 |
| [PFC-009](done/PFC-009-recette-locale.md) | Recette locale Playwright multi-navigateurs | M1 | PFC-007, PFC-008 |
| [PFC-010](done/PFC-010-protocole.md) | Schémas et projection publique du protocole v1 | M2 | PFC-002, PFC-003 |
| [PFC-011](done/PFC-011-worker-stockage.md) | Worker local et stockage Durable Object | M2 | PFC-001, PFC-010 |
| [PFC-012](done/PFC-012-rooms.md) | Création et réservation des rooms privées | M2 | PFC-011 |
| [PFC-013](done/PFC-013-websocket-auth.md) | WebSocket authentifié et isolation des joueurs | M2 | PFC-012 |
| [PFC-014](done/PFC-014-jeu-serveur.md) | Machine de jeu serveur et échéances persistées | M2 | PFC-003, PFC-013 |
| [PFC-015](done/PFC-015-lobby.md) | Interface créer rejoindre et lobby synchronisé | M2 | PFC-004, PFC-013, PFC-014 |
| [PFC-016](done/PFC-016-jeu-en-ligne.md) | Partie en ligne révélation et revanche | M2 | PFC-008, PFC-014, PFC-015 |
| [PFC-017](done/PFC-017-reconnexion.md) | Déconnexion pause reprise et session | M2 | PFC-016 |
| [PFC-018](done/PFC-018-expiration.md) | Expiration nettoyage et limites de session | M2 | PFC-017 |
| [PFC-019](done/PFC-019-recette-reseau.md) | Recette multijoueur et tests adverses | M2 | PFC-018 |
| [PFC-020](done/PFC-020-securite.md) | Durcissement abus et observabilité | M3 | PFC-019 |
| [PFC-021](done/PFC-021-accessibilite-performance.md) | Accessibilité et performance de la version complète | M3 | PFC-009, PFC-019 |
| [PFC-022](done/PFC-022-ci-staging.md) | CI reproductible et déploiement staging Cloudflare | M3 | PFC-020, PFC-021 |
| [PFC-023](done/PFC-023-release.md) | Recette finale et mise en production | M3 | PFC-022 |
| [PFC-024](done/PFC-024-regles-maquette.md) | Règles de manche de la maquette (5 s, choix unique, manche vide) | M1 | PFC-002, PFC-003 |
| [PFC-025](done/PFC-025-local-mobile-tour-par-tour.md) | Local mobile tour par tour | M1 | PFC-006 |
| [PFC-026](done/PFC-026-demo-confrontations.md) | Démo des confrontations | M1 | PFC-008 |
| [PFC-027](done/PFC-027-compilation-shaders.md) | Ouverture sans compilation bloquante des shaders (optimisation mesurée, D46, D51) | M3 | PFC-008, PFC-021 |

## Reprise d'une session agent
Lire le ticket in_progress s'il existe ; sinon le premier todo avec dépendances done.
Relire les preuves et le diff avant de reprendre. Ne pas transformer une intention précédente
en travail accompli. Les tickets de déploiement peuvent rester blocked si l'accès Cloudflare manque.
