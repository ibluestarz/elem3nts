---
name: commit
description: Préparer et créer un commit local ciblé pour un ticket vérifié du projet.
argument-hint: "PFC-xxx [message optionnel]"
disable-model-invocation: true
---

Créer le commit demandé par `$ARGUMENTS`. Cette invocation autorise le commit local, pas un push.

1. Lire CLAUDE.md et le ticket indiqué ; si aucun ticket n'est donné, identifier le périmètre réel
   du diff. Ne pas inventer un ID. Un changement hors backlog doit être rattaché avant commit.
2. Inspecter `git status --short`, `git diff`, `git diff --cached` et les derniers messages.
   Préserver l'index existant : si des fichiers/hunks tiers sont déjà indexés, arrêter avant de
   modifier l'index et expliquer la collision. Ne pas faire reset/stash pour les masquer.
3. Vérifier la DoD et les preuves du ticket. Pour du code, exécuter les gates applicables dans
   l'ordre de docs/TESTING.md si aucune preuve récente ne couvre exactement le diff final.
   Pour de la documentation seulement, vérifier liens, IDs et cohérence ; ne pas exiger un build inexistant.
4. Examiner le diff et les nouveaux fichiers pour secrets et changements non liés. Ne pas lire
   ni afficher la valeur de secrets. Ne pas inclure .env, tokens, build, traces ou dépendances installées.
5. Mettre à jour le suivi du ticket avant de l'indexer : commandes réellement exécutées,
   résultats, critères cochés, limites. Ne pas marquer done si les critères ne passent pas.
6. Indexer explicitement les seuls chemins/hunks concernés ; jamais `git add .` aveugle.
   Relire `git diff --cached --check` et `git diff --cached` ; le commit doit former une unité cohérente.
7. Écrire un message Conventional Commits : `feat(local): ajouter les choix clavier (PFC-005)`.
   Types usuels : feat, fix, test, docs, refactor, chore, ci. Expliquer le pourquoi si nécessaire.
   Passer un corps multilignes par fichier à `git commit -F`, sans interpolation de texte shell.
8. Exécuter le commit. Ne pas utiliser --no-verify, --amend, force-push ou modifier l'identité Git.
   Si Git refuse (identité/hook/signature), rapporter la cause sans contourner la protection.
9. Lire le statut et le hash créé ; résumer portée, preuves et fichiers encore modifiés.
   Si le diff est vide, le signaler sans créer de commit vide. Ne jamais pousser automatiquement.
