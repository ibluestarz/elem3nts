# Sources et usage — consultées le 27 septembre 2026

Documentation officielle ; les décisions produit de ce kit restent des propositions propres au projet.
Vérifier les versions retenues lors de l'implémentation plutôt que recopier des API historiques.

- [Claude Code — Best practices](https://code.claude.com/docs/en/best-practices) : contexte concis, travail borné, validation observable.
- [Claude Code — Mémoire](https://code.claude.com/docs/fr/memory) : CLAUDE.md, règles par chemins, chargement progressif.
- [Claude Code — Skills](https://code.claude.com/docs/en/skills) : SKILL.md et invocation manuelle des procédures à effets de bord.
- [Cloudflare — WebSockets et Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) : sockets hibernantes, restauration de l'état, bindings.
- [Cloudflare — Static Assets](https://developers.cloudflare.com/workers/static-assets/) : hébergement des assets dans Workers.
- [Cloudflare — Tarifs Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) et [binding Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) (consultés le 2026-09-29, PFC-020) : quotas, rétention, sémantique « permissive » du binding écartée au profit d'un Durable Object (D45).
- [Cloudflare — Environnements Wrangler](https://developers.cloudflare.com/workers/wrangler/environments/) et [Rollbacks](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/) : `CLOUDFLARE_ENV` choisi au build par le plugin Vite, liaisons non héritées, aucun retour par-dessus un changement de migration Durable Object (PFC-022, consulté le 2026-09-29).
- [Vite — Build](https://vite.dev/guide/build.html) : cibles JS explicites, transformations et limites des polyfills.
- [Browserslist officiel](https://github.com/browserslist/browserslist) : syntaxe exacte des requêtes demandées et consommateurs.
- [Playwright — Web server](https://playwright.dev/docs/test-webserver) : démarrer le serveur de test et attendre sa disponibilité.

Les règles markdown guident l'agent ; elles ne remplacent pas les protections CI ni les permissions
Claude Code. Ce kit ne désactive aucune protection et n'ajoute aucune autorisation shell globale.
