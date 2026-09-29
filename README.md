# Feu · Eau · Plante — kit de développement

Ce dossier prépare le développement du jeu. Il contient les instructions Claude Code,
les décisions produit, une architecture cible et 23 tickets ordonnés. Aucun jeu n'est encore implémenté.

## Installation dans votre dépôt
Copier le contenu de ce dossier à la racine du dépôt, en conservant le dossier caché `.claude`.
S'il existe déjà un `CLAUDE.md` ou des règles, fusionner après lecture plutôt que remplacer.
`CLAUDE.md` utilise la casse attendue par Claude Code. Il est à la racine ; les règles et skills
sont dans `.claude/`. Ne pas créer une deuxième copie concurrente du fichier principal.
Ces skills sont destinés à Claude Code dans ce dépôt, pas à une installation de skills ChatGPT.
Versionner l'ensemble avec le projet.

## Démarrer avec Claude Code
Ouvrir Claude Code à la racine du dépôt et envoyer :

> Lis CLAUDE.md, docs/SPEC.md, docs/DECISIONS.md et tasks/README.md.
> Commence PFC-001 seulement. Applique les choix par défaut documentés.
> Donne un plan court, implémente, exécute les vérifications disponibles et mets le ticket à jour.
> N'annonce aucune commande réussie sans preuve. Ne déploie pas.

Puis demander le prochain ticket prêt. Pour créer une évolution :
`/create-ticket Ajouter des sons désactivables`. Pour enregistrer un travail vérifié : `/commit PFC-001`.
Les skills à effet de bord sont invoqués explicitement. Aucun réglage global de permissions
ni hook exécutant automatiquement des commandes n'est fourni.

## Où trouver quoi
| Chemin | Contenu |
| --- | --- |
| `CLAUDE.md` | Point d'entrée concis pour l'agent |
| `.claude/rules/` | Contraintes ciblées par chemins |
| `.claude/skills/` | Procédures commit et création de tickets |
| `docs/SPEC.md` | Règles, mapping et déroulement |
| `docs/DECISIONS.md` | Hypothèses produit explicites et modifiables |
| `docs/ARCHITECTURE.md` | Front, moteur, serveur, hébergement |
| `docs/PROTOCOL.md` | Contrat réseau et sécurité |
| `docs/TESTING.md` | Gates, commandes et Definition of Done |
| `docs/TRACEABILITY.md` | Correspondance besoins → tickets → tests |
| `docs/SOURCES.md` | Documentation officielle consultée |
| `tasks/README.md` | Ordre, dépendances et méthode |
| `tasks/PFC-*.md` | Tickets avec critères, Gherkin et DoD |
| `tasks/_TEMPLATE.md` | Modèle pour les futures évolutions |

## Choix à connaître
Scores plancher zéro ; trois secondes avant révélation ; plante/plante donne un point au joueur
en retard ; nul OFF exige un score ≥ objectif et strictement supérieur à l'autre.
En ligne, les deux joueurs confirment avec Espace pour démarrer/rejouer.
Une déconnexion suspend la partie pendant 30 secondes, puis l'annule sans trophée.
Les trophées appartiennent à la session ; aucune persistance de compte.
Tous les détails et leurs justifications sont dans `docs/DECISIONS.md`.

## Livraison
M1 : local jouable et vérifié. M2 : rooms en ligne fiables. M3 : finition et déploiement Cloudflare.
La DA n'est pas imposée : privilégier une arène claire, feu/eau/plante identifiables par
forme + texte + couleur, avec effets Three.js légers et fallback sans WebGL.
