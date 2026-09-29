---
name: create-ticket
description: Créer des tickets de développement atomiques avec règles, mapping, Gherkin et Definition of Done.
argument-hint: "description du besoin"
disable-model-invocation: true
---

Transformer `$ARGUMENTS` en ticket(s) locaux dans tasks, sans implémenter le code ni publier d'issue externe.

1. Lire CLAUDE.md, docs/SPEC.md, docs/DECISIONS.md, tasks/README.md et tasks/_TEMPLATE.md.
2. Chercher les tickets existants qui couvrent ce besoin. Éviter les doublons ; proposer une
   mise à jour si même résultat attendu. Ne pas rouvrir arbitrairement un ticket terminé.
3. Distinguer exigence explicite, hypothèse et question réellement bloquante. Utiliser les
   défauts documentés ; si une ambiguïté change substantiellement la règle, consigner le choix
   comme proposé et marquer blocked seulement si aucun défaut raisonnable ne permet d'avancer.
4. Définir le résultat observable, inclus/exclus, contraintes et dépendances minimales.
   Découper si plusieurs résultats indépendants ; aucun chantier « tout le multijoueur ».
5. Lire les IDs présents, réserver le prochain PFC-NNN sans écraser. Créer le fichier par
   création exclusive ; si collision, relire les IDs et choisir le suivant. Ne pas renuméroter l'historique.
6. Remplir toutes les rubriques du modèle : contexte, règles, exemple mapping entrée/sortie,
   critères numérotés, Gherkin nominal + cas limite/erreur, tests, DoD et suivi.
   La DoD globale doit être liée et complétée par des critères propres au ticket.
7. Vérifier les dépendances : IDs existants, aucune auto-dépendance ni cycle. Garder le nouveau
   ticket todo (ou blocked avec raison explicite) et laisser ses cases non cochées.
8. Mettre à jour tasks/README.md et docs/TRACEABILITY.md ; si le contrat produit évolue,
   modifier la section concernée de SPEC et ajouter une décision identifiée dans DECISIONS.
9. Relire cohérence des exemples, bornes et scénarios. Présenter fichiers créés, objectif et
   ordre d'exécution. Ne pas prétendre que les tests décrits existent déjà. Ne pas committer automatiquement.
