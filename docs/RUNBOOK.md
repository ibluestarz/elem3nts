# Runbook — abus, journaux, limites (PFC-020), déploiement et retour arrière (PFC-022)

Public : la personne qui exploite ELEM3NTS sur Cloudflare (staging, production). Décisions : D45 ;
contrat : PROTOCOL « Abus, limites et en-têtes » et « Journalisation et nettoyage ».

## Où lire les journaux
- **Workers Logs** (activé par `observability.enabled` dans `wrangler.jsonc`, échantillonnage 1) : tableau de bord
  Cloudflare → Workers & Pages → `elem3nts` → Logs. Chaque événement est un objet JSON : filtrer par champ
  (`event`, `room`, `code`…), jamais par texte.
- **En direct** : `npx wrangler tail elem3nts --format json` (compte authentifié ; ne rien coller de la sortie dans
  un ticket public sans relecture, même si aucun secret n'y figure par construction).
- **En local** : `npm run dev` ou `npm run preview` écrivent les mêmes objets dans le terminal (forme `util.inspect`).

## Événements
Champs possibles : `room` (identifiant hexadécimal du Durable Object, **pas** le code), `phase`, `match`, `round`,
`revision`, `slot` (0 = J1, 1 = J2), `code`, `close`, `by`, `command`, `bucket`, `reason`, `durationMs`, `error`.
Jamais : token, empreinte, `requestId`, charge d'une trame, choix, adresse IP, message ou pile d'erreur.

| Événement | Quand | À surveiller |
| --- | --- | --- |
| `http.rejected` | 403 `ORIGIN_FORBIDDEN` ou 429 `RATE_LIMITED` (`bucket` : `entry`, `socket`) avant toute room | pic de `RATE_LIMITED` : abus ou IP partagée (voir plus bas) |
| `http.internal` | 500 `INTERNAL` du Worker (`error` = nom) | toute occurrence : bogue |
| `limiter.unavailable` | limiteur injoignable : **requête admise sans limite** | toute occurrence : la protection est suspendue |
| `room.created` / `seat.reserved` / `seat.released` | J1 réservé / J2 réservé / J2 jamais connecté, libéré | rapport créations / parties démarrées |
| `socket.authenticated` / `socket.closed` | place prise ; fermeture (`close`, `by`, `durationMs`) | `close` 4429 (abus de trames), 1011 (erreur) |
| `socket.evicted` | socket en attente fermée (plafond de 2 par room) | répété sur une même `room` : quelqu'un inonde la room avec son code |
| `socket.refused` | socket ouverte sur une room absente, expirée ou fermée (4404) | volume élevé : tentatives d'énumération |
| `message.rejected` | trame refusée (`code` du protocole) | `INVALID_MESSAGE` en série : client modifié |
| `command.applied` | commande acceptée qui modifie la room (`command` = type seul) | suivre une partie par `room` puis `revision` |
| `room.advanced` | échéance de jeu traitée (ouverture, sélection, résultat) | — |
| `seat.absent` | place sans socket : pause (D15) | fréquence : qualité réseau des joueurs |
| `room.closed` | `reason` : `left`, `inactive`, `max-duration`, `reconnect-timeout`, `host-absent` | répartition des fins de vie |
| `socket.internal` / `alarm.failed` | panne pendant une trame (1011) / alarme en échec, relancée par le runtime (`error` = nom, `RoomStorageError:<code>` pour le stockage) | toute occurrence ; `RoomStorageError:CORRUPT` ou `SCHEMA_TOO_NEW` : room illisible |

Suivre une partie : filtrer `room = <id>` et trier par `revision` ; `match`, `round` et `phase` donnent le contexte.
Obtenir l'identifiant d'une room à partir d'un signalement : le joueur ne connaît que le code, qui n'est jamais
journalisé (il vaut invitation). Demander l'heure et l'issue, puis chercher `room.closed` / `socket.closed` à cette heure.

## Limites en place (D45)
| Limite | Valeur | Réglage |
| --- | --- | --- |
| Créations + jonctions par IP | 10 / 60 s glissantes | `ENTRY_RATE_LIMIT` |
| Ouvertures de socket par IP | 60 / 60 s glissantes | `SOCKET_RATE_LIMIT` |
| Sockets en attente par room | 2 (la plus ancienne fermée en 4408) | `MAX_PENDING_SOCKETS` |
| Par connexion (PFC-013) | 4 KiB, 20 trames/s, rafale 30, 4429 au 3e dépassement | `MESSAGES_PER_SECOND`, `MESSAGE_BURST` |

Constantes dans `src/shared/protocol/socket.ts`. Les modifier met à jour PROTOCOL, D45 et les tests qui écrivent le
contrat en clair (`tests/integration/abuse.test.ts`, `tests/e2e/security.spec.ts`), puis passe par le gate complet.
Clé : `CF-Connecting-IP`, IPv6 regroupée par /64. Un refus n'est pas compté : attendre `Retry-After` suffit.

## Incidents
**Plaintes « Trop de tentatives »** : plusieurs joueurs derrière une même IP (école, entreprise, CGNAT mobile)
partagent un budget. Vérifier le volume `http.rejected` `bucket=entry`. Une jonction ratée (code mal saisi) compte aussi.
Si le cas est légitime et récurrent, relever `ENTRY_RATE_LIMIT` (le coût d'une création reste borné par D16).

**Pic d'abus** (créations en masse, inondation de sockets) : les limites par IP bornent chaque source. Contre un
volume distribué (nombreuses IP), ce Worker ne suffit pas : ajouter une règle de limitation de débit ou WAF sur la
zone Cloudflare pour `/api/*` (hors dépôt, configuration du compte). Ne jamais journaliser les IP pour enquêter.

**`limiter.unavailable`** : les requêtes passent sans limite. Vérifier l'état des Durable Objects (tableau de bord,
statut Cloudflare). Le jeu reste jouable ; aucune action côté code tant que la panne est transitoire.

**`alarm.failed` / `socket.internal` répétés sur une room** : le runtime relance l'alarme ; rien de non persisté n'a
été publié. `RoomStorageError:CORRUPT` ou `SCHEMA_TOO_NEW` : la room répond `ROOM_UNAVAILABLE` (échec fermé, D35) et
expire d'elle-même ; ne pas la réécrire à la main.

**Retour arrière** : voir « Déployer et revenir en arrière » ci-dessous. La migration `v2` (classe `Limiter`) est
append-only ; ne jamais la retirer de `wrangler.jsonc`.

## Déployer et revenir en arrière (PFC-022, D48)
| Environnement | Worker | Adresse | Publication |
| --- | --- | --- | --- |
| staging | `elem3nts-staging` | https://elem3nts-staging.elem3nts.workers.dev | CI : Actions → CI → Run workflow (`main`, `deploy_staging`) ; ou local |
| production | `elem3nts` | https://elem3nts.elem3nts.workers.dev | `npm run deploy:production`, sur demande explicite, depuis un commit exact |

Les deux Workers ont chacun leurs Durable Objects : rooms, limites et journaux de staging ne touchent jamais la
production. Le Worker est créé par le premier `wrangler deploy` : ne rien créer dans le tableau de bord, et **ne pas
activer Cloudflare Access** (il bloquerait les joueurs et les WebSockets).

**Publier depuis un poste** (accès : `npx wrangler login` par le propriétaire, ou `CLOUDFLARE_API_TOKEN` et
`CLOUDFLARE_ACCOUNT_ID` exportés, jamais écrits dans un fichier suivi) :
`CLOUDFLARE_ENV=staging npm run verify && npm run deploy:staging`, puis
`SMOKE_URL=https://elem3nts-staging.elem3nts.workers.dev npm run test:smoke`. Le script refuse un artefact construit pour
une autre cible et publie avec `--strict` (refus si le Worker a été modifié hors dépôt). Chaque version porte le commit
en tag (12 caractères) et en message (`staging <sha>`, `+ modifications locales` si l'arbre n'était pas propre).
Jeton CI : jeton d'API limité au compte, droits Workers Scripts:Edit (plus lecture du compte et de l'utilisateur).

**Livrer en production** (PFC-023, D50), dans cet ordre, sans sauter d'étape :
1. Commit de livraison poussé ; CI GitHub verte sur ce commit (gates complets).
2. Staging publiée depuis ce commit (`CLOUDFLARE_ENV=staging npm run verify && npm run deploy:staging`, ou job
   `deploy-staging`) ; smoke staging vert.
3. Depuis une extraction **propre** de ce commit (`git worktree add --detach <dossier> <sha>`, `npm ci`) :
   `npm run verify` (artefact de production, sans `CLOUDFLARE_ENV`), puis `npm run deploy:production` (refusé si
   l'arbre est modifié ou l'artefact d'une autre cible).
4. `SMOKE_URL=https://elem3nts.elem3nts.workers.dev npm run test:smoke` (parcours local et room privée) et contrôle
   des en-têtes ; version, commit et résultats consignés dans le ticket de livraison ; tag git `vX.Y.Z` sur le commit.

**Régression détectée pendant la recette** (gate rouge, smoke en échec, ex. trophée attribué deux fois) : la
livraison s'arrête là, rien n'est publié. Créer un ticket correctif (`/create-ticket`) qui cite le test en échec et
sa sortie ; reprendre la procédure au point 1 une fois le correctif vert. Ne jamais relâcher un test pour livrer.

**Contrôles après publication** : smoke vert ; `curl -sI <adresse>/` (en-têtes ci-dessous) ;
`npx wrangler deployments list --name <worker>` montre la version active et son message.

**Revenir en arrière** : `npx wrangler versions list --name <worker>` (tag = commit), puis
`npx wrangler rollback <version-id> --name <worker> --message "<raison>"`, puis le smoke. Limites Cloudflare
([Rollbacks](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/)) : 100 dernières
versions seulement ; **aucun retour par-dessus un changement de migration Durable Object** ; le stockage n'est jamais
modifié par un retour. Pour ce dépôt :
- versions avec les migrations `v1` + `v2` (depuis PFC-020, toutes celles publiées par PFC-022) : retour libre entre elles ;
- une future migration `v3` rendra le retour vers les versions antérieures impossible : la publier seule, après smoke
  staging, et préparer un correctif en avant plutôt qu'un retour ;
- **compatibilité des rooms persistées** : `room_state.schema_version` (ARCHITECTURE « Worker ») ; une version plus
  récente migre en lecture (`MIGRATIONS[n]`), une version plus ancienne qui trouve un schéma plus récent échoue fermé
  (`SCHEMA_TOO_NEW` → `ROOM_UNAVAILABLE`, `alarm.failed` `RoomStorageError:SCHEMA_TOO_NEW`) et la room expire d'elle-même
  (D43). Un changement de schéma impose donc : lecture de l'ancien schéma testée avant publication, et accepter qu'un
  retour arrière ferme les rooms déjà réécrites (au plus 4 h de parties, D16) ; ne jamais réécrire une room à la main.

## En-têtes de sécurité
Pages et fichiers : `public/_headers` (CSP `'self'` stricte, `nosniff`, `no-referrer`, `DENY`, COOP, Permissions-Policy,
HSTS). API : `src/worker/http.ts`. Contrôle rapide après déploiement :
`curl -sI https://<hôte>/ | grep -i -E 'content-security|x-frame|referrer|strict-transport'`.
Toute dépendance à une autre origine (police, script, image, analytics) exige de modifier la CSP : ce MVP n'en a
aucune (hors périmètre : analytics tiers). En `npm run dev`, Vite sert les fichiers sans ces en-têtes (HMR inline).

## Offre Cloudflare (relevé du 2026-09-29, revérifié le 2026-09-30 avant la mise en production : inchangé)
Sources : [tarifs Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/),
[binding Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

| Poste | Gratuit | Payant |
| --- | --- | --- |
| Requêtes Durable Objects | 100 000 / jour | 1 million / mois inclus, puis 0,15 $ / million |
| Durée Durable Objects | 13 000 Go-s / jour | 400 000 Go-s / mois inclus, puis 12,50 $ / million de Go-s |
| Lignes SQLite écrites | 100 000 / jour | 50 millions / mois inclus, puis 1 $ / million |
| Stockage SQLite | 5 Go au total | 5 Go-mois inclus, puis 0,20 $ / Go-mois |
| Workers Logs | 200 000 événements / jour, 3 jours de rétention | 20 millions / mois inclus, 7 jours, puis 0,60 $ / million |
| Taille d'un événement | 256 Ko | 256 Ko |

Coût propre à PFC-020 : chaque création, jonction et ouverture de socket ajoute une requête au limiteur et une ligne
écrite (son journal), plus une alarme ; le stockage d'une IP disparaît une minute après sa dernière tentative. Une
partie typique émet quelques dizaines d'événements (création, connexions, ~5 par manche, fermeture) : sur l'offre
gratuite, le quota de journaux (200 000/jour) est atteint vers quelques milliers de parties par jour, avant celui des
requêtes Durable Objects. Au-delà, baisser `head_sampling_rate` coupe des événements au hasard : préférer l'offre payante.

Le binding Rate Limiting n'est pas utilisé : compteurs par emplacement Cloudflare, « permissifs, éventuellement
cohérents » et non destinés à un décompte exact, périodes de 10 ou 60 s seulement ; la documentation déconseille en
outre l'IP comme clé. Il peut compléter plus tard une limite grossière de volume, jamais remplacer le quota atomique.
