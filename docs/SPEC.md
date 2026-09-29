# Spécification produit — Feu · Eau · Plante

## Contexte et périmètre
Un duel inspiré de pierre-feuille-ciseaux : feu bat plante, plante bat eau, eau bat feu.
Deux humains jouent en local sur le même clavier (tour par tour sur un seul téléphone) ou en ligne
dans une room privée par code.
Une **manche** oppose deux choix ; une **partie** finit à l'objectif X ; une **session** contient
plusieurs parties et leurs trophées. Hors MVP : compte, IA, classement global, matchmaking,
chat, spectateurs, achats, personnalisation d'avatar et application native.

## Réglages et démarrage
À l'accueil : mode local / créer une room / rejoindre par code, accès aux règles.
Avant la partie : X entier 1–10, nul ON/OFF, affichage des touches. Défauts : X=3 et nul ON.
Local : Espace ou bouton « Jouer » démarre. En ligne : l'hôte règle la partie, les deux
joueurs doivent être connectés et prêts via Espace ou « Prêt ».
Chaque modification des réglages retire les confirmations des deux joueurs.
Les réglages sont figés pendant la partie et partagés par les deux clients.

## Règles normatives R01–R12
- R01 : scores initiaux 0/0 ; chaque score est un entier ≥ 0 ; pas de plafond à X.
- R02 : choix différents : +1 au gagnant de la manche ; score du perdant inchangé.
- R03 : feu/feu : +1 à chacun simultanément.
- R04 : eau/eau : -1 à chacun avec plancher zéro.
- R05 : plante/plante : le joueur strictement en retard avant la résolution gagne +1 ; si égalité, aucun changement.
- R06 : appliquer les deux deltas à partir du même état avant manche, puis seulement évaluer la fin.
- R07 : nul ON : deux scores ≥ X → nul ; sinon un score ≥ X → ce joueur gagne ; sinon continuer.
- R08 : nul OFF : gagner exige score ≥ X et strictement supérieur au score adverse ; égalité → continuer.
  L'interface nomme cette prolongation « mort subite » ; ce n'est pas une règle distincte.
- R09 : victoire de partie = +1 trophée au gagnant ; nul = +1 chacun ; aucun trophée par manche ou annulation.
- R10 : une résolution et une attribution de trophées par identifiant ; ignorer/rejeter les doublons sans nouvel effet.
- R11 : un seul joueur a choisi avant l'échéance : +1 à ce joueur, score adverse inchangé.
- R12 : aucun joueur n'a choisi avant l'échéance : manche annulée, aucun point ; la partie continue.

## Mapping exhaustif des éléments
Deltas appliqués sur les scores avant la manche. Pour eau, borner à zéro après le delta.

| J1 | J2 | Δ J1 | Δ J2 | Explication |
| --- | --- | --- | --- | --- |
| Feu | Feu | +1 | +1 | Double feu |
| Feu | Eau | 0 | +1 | Eau éteint feu |
| Feu | Plante | +1 | 0 | Feu brûle plante |
| Eau | Feu | +1 | 0 | Eau éteint feu |
| Eau | Eau | -1 | -1 | Double eau |
| Eau | Plante | 0 | +1 | Plante absorbe eau |
| Plante | Feu | 0 | +1 | Feu brûle plante |
| Plante | Eau | +1 | 0 | Plante absorbe eau |
| Plante | Plante | +1 si J1 en retard | +1 si J2 en retard | Aucun point si scores égaux |
| Élément | Aucun | +1 | 0 | Seul choix de la manche (R11) |
| Aucun | Élément | 0 | +1 | Seul choix de la manche (R11) |
| Aucun | Aucun | 0 | 0 | Manche annulée (R12) |

## Exemples chiffrés
| X | Nul | Avant | Choix J1/J2 | Après | Résultat de partie |
| --- | --- | --- | --- | --- | --- |
| 3 | ON | 2/1 | feu/plante | 3/1 | J1, +1 trophée |
| 3 | ON | 2/2 | feu/feu | 3/3 | Nul, +1 trophée chacun |
| 3 | OFF | 2/2 | feu/feu | 3/3 | Continuer |
| 3 | OFF | 3/3 | feu/plante | 4/3 | J1, +1 trophée |
| 3 | OFF | 3/3 | eau/eau | 2/2 | Continuer |
| 3 | ON | 0/1 | eau/eau | 0/0 | Continuer |
| 5 | ON | 1/3 | plante/plante | 2/3 | Continuer |
| 5 | ON | 3/1 | plante/plante | 3/2 | Continuer |
| 5 | ON | 2/2 | plante/plante | 2/2 | Continuer |
| 1 | ON | 0/0 | feu/feu | 1/1 | Nul immédiat |
| 10 | OFF | 9/9 | feu/feu | 10/10 | Continuer |

## Cycle de manche
1. Phase `selecting` : 5 secondes pour choisir, décompte visible ; chaque choix est verrouillé au
   premier choix valide. La fenêtre va toujours jusqu'à zéro, même si les deux choix sont verrouillés.
2. Ne montrer que « choix verrouillé »/« choix en cours », jamais l'élément adverse.
3. À l'échéance, révéler les éléments et calculer une seule résolution (R02–R06, R11, R12). L'effet de la
   confrontation suit (chronologie D09) ; son impact affiche l'explication et les nouveaux scores. Sans WebGL,
   les mêmes échéances s'appliquent et l'explication reste textuelle (D33).
4. Si fin, afficher « Joueur 1 a gagné », « Joueur 2 a gagné » ou « Match nul » et trophées.
5. Sinon phase `round-result` (D09), puis nouvelle manche avec choix effacés ; en nul OFF, une égalité
   au-delà de X affiche d'abord « Mort subite ». La fin de partie s'affiche 0,7 s après le dernier résultat.

Local sur un seul téléphone (scène de moins de 720 px de large) : tour par tour. J1 dispose de 5 s,
puis un voile opaque masque l'écran pendant le passage de l'appareil ; J2 dispose de 5 s. Le choix de J2,
ou son échéance, déclenche la révélation. Limite acceptée : les choix ne sont plus simultanés.

En ligne, les échéances viennent du serveur. L'animation ne déclenche jamais une résolution.
Une room se ferme sans trophée après 30 minutes sans activité utile (des manches sans aucun choix n'en sont pas)
ou 4 heures après sa création, pause comprise ; les deux joueurs en sont informés (PROTOCOL, D43).
Si une pause interrompt l'ouverture, la sélection ou le résultat, conserver la phase, les choix
et le temps restant ; reprendre à cette phase après reconnexion (voir PROTOCOL, D42).

## Saisie et accessibilité
Local : positions physiques KeyA/KeyS/KeyD pour J1 et KeyJ/KeyK/KeyL pour J2.
Afficher les libellés de disposition via Keyboard Layout API si disponible ; sinon proposer
un affichage AZERTY (Q/S/D) ou QWERTY (A/S/D) pour J1, sans changer les codes physiques.
Aucune saisie n'exige un accord de plusieurs touches ; tester le jeu séquentiel.
Ignorer répétitions `event.repeat`, touches hors sélection et raccourcis dans les champs
input/textarea/select/contenteditable. Ne pas doubler l'action native Espace d'un bouton ciblé.
Une pression d'Espace = une action contextuelle ; empêcher le scroll seulement si elle est traitée.
Focus visible, score textuel, formes distinctes, annonces accessibles modérées, reduced-motion.
En ligne : boutons feu/eau/plante et les touches J1 pour sa propre place, même si l'on est J2.

## Session et revanche
Local : revanche immédiate via Espace/bouton ; scores et choix remis à zéro, réglages et trophées conservés.
En ligne : chaque joueur confirme la revanche ; les deux confirmations déclenchent un nouveau matchId.
L'hôte peut changer les réglages avant la revanche, ce qui efface les confirmations.
Retour accueil termine la session locale. En ligne, quitter ferme la room ; aucune récompense
si la partie n'était pas terminée. Un écran terminé ne réattribue pas de trophée à la reconnexion.
