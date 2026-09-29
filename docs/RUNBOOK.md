# Runbook — abus, journaux et limites (PFC-020)

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

**Retour arrière** : la migration `v2` (classe `Limiter`) est append-only ; ne jamais la retirer de `wrangler.jsonc`.
Revenir à une version antérieure à PFC-020 suppose de conserver la classe exportée (ou une migration de suppression
explicite) : à préparer avec le rollback de PFC-022/023, jamais improvisé en production.

## En-têtes de sécurité
Pages et fichiers : `public/_headers` (CSP `'self'` stricte, `nosniff`, `no-referrer`, `DENY`, COOP, Permissions-Policy,
HSTS). API : `src/worker/http.ts`. Contrôle rapide après déploiement :
`curl -sI https://<hôte>/ | grep -i -E 'content-security|x-frame|referrer|strict-transport'`.
Toute dépendance à une autre origine (police, script, image, analytics) exige de modifier la CSP : ce MVP n'en a
aucune (hors périmètre : analytics tiers). En `npm run dev`, Vite sert les fichiers sans ces en-têtes (HMR inline).

## Offre Cloudflare (relevé du 2026-09-29, à revérifier avant la mise en production)
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
