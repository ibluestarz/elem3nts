# PFC-015 — Interface créer rejoindre et lobby synchronisé

- Statut : done
- Priorité : P1
- Lot : M2
- Dépendances : PFC-004, PFC-013, PFC-014

## Contexte et objectif
Permettre à deux utilisateurs de se retrouver puis confirmer la même partie.

## Périmètre
UI create/join, code copiable, état attente, contrôles hôte, disponibilité, erreurs. Exclut chat et pseudonymes.

## Règles et contraintes
D18 identités fixes ; settings autoritaires ; deux confirmations nécessaires ; code sans token partageable.
Depuis PFC-013 (D37) : socket sur `roomSocketPath(code)` (même origine, `ws:`/`wss:` selon la page), première trame
`authenticate` sous 5 s ; le premier `state` arrive avant l'ack. Réagir aux codes de fermeture `SOCKET_CLOSE_CODES`
(`src/shared/protocol/socket.ts`) : 4401 oublier le token, 4404 room disparue, 4409 ne pas se reconnecter seul.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| deux joueurs connectés au lobby | J1 puis J2 appuient sur Espace | les deux passent à la même partie |
| J2 est prêt au lobby | J1 modifie X | les deux confirmations sont retirées et les nouveaux réglages sont visibles |

## Critères d'acceptation
- [x] AC1 : Le code, ou un lien d'invitation qui ne contient que le code (D39), est copié ; jamais le resumeToken.
- [x] AC2 : Invité voit les réglages hôte sans pouvoir les changer ; toute modification retire les ready.
- [x] AC3 : Erreurs room pleine/absente, réseau et échec presse-papier sont explicites ; double clic create ne laisse pas de rooms orphelines.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Interface créer rejoindre et lobby synchronisé
  Scénario: PFC-015-S1 — Départ concerté
    Étant donné deux joueurs connectés au lobby
    Quand J1 puis J2 appuient sur Espace
    Alors les deux passent à la même partie
  Scénario: PFC-015-S2 — Changement de paramètres
    Étant donné J2 est prêt au lobby
    Quand J1 modifie X
    Alors les deux confirmations sont retirées et les nouveaux réglages sont visibles
```

## Tests et vérification
Testing Library états chargement/erreur ; Playwright deux BrowserContexts, presse-papier fallback et double clic.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-015-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : terminée (2026-09-28). Client en ligne `src/client/online/` (`api.ts`, `connection.ts`, `invite.ts`,
  `clipboard.ts`, `messages.ts`, `useOnlineRoom.ts`) ; écran `src/client/screens/OnlineScreen.tsx` et `screens/online/`
  (`InviteCard`, `JoinForm`, `TargetRow`, `Lobby`) ; `Stage.tsx` (écran `online`, lien `/p/CODE`) ; `ownsKey` déplacé dans
  `input/useLocalKeys.ts`. Transitions d'étape, éclat doré des réglages changés, toasts de présence, mouvements réduits.
- Décisions nouvelles : D39 (arbitrages du propriétaire : lien d'invitation sans token, code 8 caractères groupé 4·4,
  bouton de prototype retiré et lobby ajouté ; défauts : token en mémoire, réglages sérialisés, réactions aux fermetures) ;
  D29 mis à jour. AC1 reformulé en conséquence. PROTOCOL, ARCHITECTURE, TESTING, TRACEABILITY complétés.
- Commandes exécutées / résultats :
  - `npm run verify` → exit 0 : build (tsc -b, vite build, wrangler --dry-run) OK ; `test:functional` 40 fichiers,
    585 tests passés ; `lint` 0 problème ; `test:e2e` 171 passés, 12 ignorés (tous PFC-008, WebGL Chromium seul,
    préexistants). Premier passage en échec au lint (6 erreurs dans les tests ajoutés), corrigé puis gate relancé en entier.
  - `npm run baseline:mockup -- --only online-` : 4 références capturées depuis la maquette ; parité `online-menu` et
    `online-join` à tolérance nulle (1280×800, 390×844), champ « Code reçu » en zone fixe.
  - Mutation contrôlée (restaurée) : garde synchrone de création retirée → test du double clic en échec.
  - Parcours manuel à deux navigateurs sur `npm run preview` (création, copie, lien, lobby, réglages, prêts, départ) :
    aucune erreur console ; captures bureau et 390 px revues contre la maquette.
- Preuves / fichiers : `tests/e2e/lobby.spec.ts` (S1, S2, AC1–AC3, 3 navigateurs), `tests/unit/client/OnlineScreen.test.tsx`,
  `roomConnection.test.ts`, `onlineApi.test.ts`, `onlineInvite.test.ts`, `onlineFakes.ts`, `tests/e2e/visual.spec.ts` +
  `support.ts` (états `online-*`, `zoneRect`), `scripts/capture-mockup-baseline.ts` (`--only`).
- Limites : vues hôte, lobby et « Adversaire trouvé » sans parité stricte (écarts D39, revue de captures) ; la partie
  en ligne elle-même (arène) relève de PFC-016, la reprise après coupure ou rechargement de PFC-017 ; une place libérée
  par déconnexion au lobby reste réservée jusqu'à PFC-017/018.
