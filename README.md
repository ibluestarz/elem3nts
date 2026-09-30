# ELEM3NTS — Feu · Eau · Plante

Duel web à deux joueurs inspiré de pierre-feuille-ciseaux : **feu brûle plante, plante absorbe eau, eau éteint
feu**. On joue à deux sur un même clavier, à tour de rôle sur un seul téléphone, ou en ligne dans une room privée.

**Jouer : https://elem3nts.bluestarz.workers.dev** (version 1.0.0). Aucun compte, aucune installation.

## Comment jouer
- **Une manche** : chacun a 5 secondes pour choisir un élément ; le premier choix est définitif et reste caché
  jusqu'à la révélation, qui a lieu à la fin du décompte.
- **Points** : le vainqueur de la manche prend +1. Mêmes éléments : feu + feu, +1 chacun ; eau + eau, −1 chacun
  (jamais sous zéro) ; plante + plante, +1 au joueur en retard. Un seul joueur a choisi : +1 pour lui ; personne :
  manche annulée.
- **Partie** : premier à X points (1 à 10, 3 par défaut). Avec « nul » activé, deux joueurs qui atteignent X
  ensemble font match nul ; sinon il faut atteindre X avec au moins un point d'avance (« mort subite »).
- **Trophées** : +1 au vainqueur de chaque partie, +1 à chacun en cas de nul. Ils durent le temps de la session
  (revanches comprises) et ne sont jamais stockés sur un compte.

| Mode | Commandes |
| --- | --- |
| Local, clavier partagé | Joueur 1 : Q/S/D sur AZERTY (A/S/D sur QWERTY) ; Joueur 2 : J/K/L. Espace lance et relance. |
| Local, un seul téléphone | Tour par tour : un voile cache l'écran entre les joueurs ; chacun touche « Je suis prêt », puis choisit en 5 s. |
| En ligne | L'hôte crée une room et partage le lien ou le code à 8 caractères ; chacun joue avec ses boutons ou Q/S/D. |

En ligne, une déconnexion met la partie en pause 30 secondes le temps de revenir ; une room inutilisée se ferme
après 30 minutes, et toute room après 4 heures. L'accueil propose aussi les règles, les réglages (touches, qualité
3D, mouvements réduits) et une démo des neuf confrontations. Règles complètes : [docs/SPEC.md](docs/SPEC.md).

## Développer
Prérequis : Node 24 (`nvm use`, voir `.nvmrc`). Navigateurs de test : `npx playwright install chromium firefox
webkit`, puis `sudo npx playwright install-deps chromium firefox webkit` sous Linux/WSL.

| Commande | Rôle |
| --- | --- |
| `npm ci` | Installation reproductible (lockfile, versions exactes) |
| `npm run dev` | Front et Worker local sur la même origine (http://localhost:5173) |
| `npm run build` | Typecheck, bundle de production, validation du Worker sans publier |
| `npm run test:functional` | Vitest : domaine, protocole, composants, Worker local réel |
| `npm run lint` | ESLint, zéro avertissement |
| `npm run test:e2e` | Playwright Chromium, Firefox et WebKit contre le build servi par le Worker local |
| `npm run verify` | Les quatre gates ci-dessus, dans cet ordre, arrêt au premier échec |

Stack : TypeScript strict, React, Vite, Three.js, Cloudflare Workers (Static Assets et un Durable Object par room).
Un seul moteur de règles pur (`src/domain/`) sert le jeu local et le serveur ; en ligne, seul le serveur décide.

## Livrer
- **CI** (GitHub Actions, `.github/workflows/ci.yml`) : les gates à chaque push et pull request. La staging se
  publie à la demande (Actions → CI → Run workflow, case `deploy_staging`), seulement après des gates verts.
- **Staging** : https://elem3nts-staging.bluestarz.workers.dev. **Production** : https://elem3nts.bluestarz.workers.dev,
  publiée à la main depuis un commit exact (`npm run deploy:production`).
- Procédure de livraison, contrôles, retour arrière et incidents : [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Où trouver quoi
| Chemin | Contenu |
| --- | --- |
| `docs/SPEC.md` | Règles, mapping et déroulement |
| `docs/DECISIONS.md` | Décisions produit et techniques, avec leurs motifs |
| `docs/ARCHITECTURE.md` | Front, moteur, serveur, hébergement |
| `docs/PROTOCOL.md` | Contrat réseau et sécurité |
| `docs/TESTING.md` | Gates, commandes et Definition of Done |
| `docs/TRACEABILITY.md` | Correspondance besoins → tickets → tests |
| `docs/RUNBOOK.md` | Exploitation : livraison, retour arrière, journaux, limites, incidents |
| `docs/SOURCES.md` | Documentation officielle consultée |
| `tasks/README.md` | Backlog, ordre et méthode ; tickets terminés dans `tasks/done/` |
| `elem3nts-design/` | Maquette de référence : le rendu doit lui être identique |

## Travailler avec Claude Code
`CLAUDE.md` est le point d'entrée des agents ; règles et procédures dans `.claude/`. `/create-ticket <besoin>` crée
un ticket à partir du modèle, `/commit PFC-xxx` enregistre un travail vérifié. Hors MVP : comptes, matchmaking
public, bots, boutique, classement global.
