# PFC-016 — Partie en ligne révélation et revanche

- Statut : done
- Priorité : P1
- Lot : M2
- Dépendances : PFC-008, PFC-014, PFC-015

## Contexte et objectif
Offrir le même jeu en ligne avec des clients qui affichent la vérité serveur.

## Périmètre
Adaptateur réseau UI, saisie de sa place, décompte de sélection interpolé, résultats, trophées et rematch-ready. Exclut reconnexion automatique.

## Règles et contraintes
PROTOCOL révisions ; pas de score optimiste ; touches A/S/D pour sa place ; une seule source de résolution.
Références : [SPEC](../../docs/SPEC.md), [décisions](../../docs/DECISIONS.md),
[architecture](../../docs/ARCHITECTURE.md), [protocole](../../docs/PROTOCOL.md).

## Exemple / mapping
| Entrée / état | Action | Sortie attendue |
| --- | --- | --- |
| J2 est connecté en phase selecting | J2 presse KeyA | feu est soumis pour J2 et non J1 |
| une partie en ligne est terminée | seul J1 confirme rejouer | les deux restent en attente sans remise à zéro prématurée |

## Critères d'acceptation
- [x] AC1 : Les deux clients voient mêmes scores, résultat et trophées ; aucun choix adverse avant révélation.
- [x] AC2 : Un state retardé ne fait pas régresser l’UI ; horloge locale n’invente aucun résultat.
- [x] AC3 : Espace confirme une revanche mais attend l’autre ; nouveau matchId, scores zéro et trophées conservés.

## Scénarios Gherkin
```gherkin
# language: fr
Fonctionnalité: Partie en ligne révélation et revanche
  Scénario: PFC-016-S1 — J2 choisit
    Étant donné J2 est connecté en phase selecting
    Quand J2 presse KeyA
    Alors feu est soumis pour J2 et non J1
  Scénario: PFC-016-S2 — Revanche partagée
    Étant donné une partie en ligne est terminée
    Quand seul J1 confirme rejouer
    Alors les deux restent en attente sans remise à zéro prématurée
```

## Tests et vérification
E2E à deux contextes avec Worker réel, trames capturées avant/après reveal, mauvais ordre de snapshots testé unitairement.
Les scénarios ci-dessus ne limitent pas les autres cas exigés par les critères d'acceptation.

## Definition of Done
- [x] AC1 à AC3 vérifiés avec preuves, y compris les erreurs décrites.
- [x] Scénarios PFC-016-S1 et S2 traduits en tests appropriés et exécutés.
- [x] [DoD commune](../../docs/TESTING.md) satisfaite ; gates indisponibles explicitement signalés.
- [x] Contrats et documents impactés cohérents ; aucune régression du parcours déjà livré.
- [x] Suivi ci-dessous rempli et statut mis à jour.

## Suivi
- Implémentation : terminée (2026-09-29), décisions consignées en D40.
  - **Client réseau** : `online/serverClock.ts` (décalage serveur → local monotone), `connection.ts` (instants de
    réception, `ping` toutes les 5 s après authentification, latence), `online/game.ts` (point de vue « Vous » à
    gauche, chronologie calée sur `deadline − roundResultMs`, modèle d'arène, fin, scène), `useTimelinePhase.ts`,
    `useOnlineRoom.ts` (choix, revanche, quitter, réglages en fin de partie, toasts de présence).
  - **UI** : arène commune `screens/ArenaFrame.tsx` + `arenaModel.ts` (local inchangé, parité locale intacte),
    `screens/online/OnlineArena.tsx` (zones à toucher sur les éléments 3D, repli en boutons, état « En ligne · N ms »),
    `EndScreen` paramétré (Victoire/Défaite/Nul, « En attente de Joueur N… », information de revanche polie),
    `screens/online/SettingsPanel.tsx` (extrait du lobby, réutilisé avant la revanche), `RoundTimer` compact,
    notifications déplacées hors des informations de jeu (`Stage.css`).
  - **Scène** : révélation émise même quand un état tardif arrive pendant l'effet (`scene/commands.ts`).
- Remise en cause du ticket (senior) :
  - l'ouverture `starting` montre l'arène et sa bannière (D38) : la vue « Adversaire trouvé » de D39, provisoire, disparaît ;
  - SPEC « Session et revanche » exige que l'hôte puisse changer les réglages avant la revanche : ajouté (le serveur l'acceptait déjà) ;
  - sans positions 3D (repli, scène non mesurée), une rangée de boutons garantit qu'un joueur au toucher peut choisir ;
  - « Vous remportez la partie » corrige l'accord de la maquette (« Vous remporte ») : seul écart de texte voulu, réversible.
- Commandes exécutées / résultats :
  - `npm run verify` → exit 0 : build (tsc -b, vite build, wrangler --dry-run) OK ; `test:functional` 42 fichiers,
    616 tests passés ; `lint` 0 problème ; `test:e2e` 187 passés, 12 ignorés (préexistants : PFC-008, WebGL Chromium seul).
  - Avant le gate complet : `npx playwright test online.spec.ts lobby.spec.ts` (3 navigateurs) ; premier passage
    avec S2 en échec à cause du test (Espace sur le bouton « + » ciblé garde son action native, conforme SPEC),
    corrigé en cliquant « Rejouer », puis 3/3 vert.
  - Parité : `npm run baseline:mockup -- --only online-arena|online-select|online-result|online-end` (7 références
    capturées depuis la maquette) ; empreintes MD5 des 30 références existantes inchangées ; 7/7 à tolérance nulle hors zones.
  - Mutations contrôlées (restaurées), toutes détectées par les tests : révision ancienne acceptée, sélection révélée
    par l'horloge locale, touches de Joueur 2, revanche envoyée deux fois, point de vue ignoré, horloge non monotone.
  - Parcours manuel à deux navigateurs (bureau + 390 px) sur `npm run preview` : ouverture, verrous, révélation,
    résultat, fin, attente de revanche, nouvelle partie ; aucune erreur console ; captures revues.
- Preuves / fichiers : `tests/e2e/online.spec.ts` (S1/AC1 trames sans élément avant `round-result`, S2/AC3, départ),
  `tests/e2e/online-driver.ts` (partagé avec `lobby.spec.ts`, S1 PFC-015 mis à jour), `tests/e2e/online-fake.ts`,
  `tests/e2e/visual.spec.ts` + `support.ts` (états `online-*`, `appReach`, `zones`, `trinity`),
  `scripts/capture-mockup-baseline.ts`, `tests/unit/client/OnlineGame.test.tsx`, `onlineGame.test.ts`,
  `OnlineScreen.test.tsx`, `onlineFakes.ts` ; docs : DECISIONS D40, PROTOCOL, ARCHITECTURE, TESTING, TRACEABILITY,
  notes de reprise dans PFC-017.
- Limites : pause et reprise après coupure (`paused` affiché sans décompte, écran « Connexion interrompue » de la
  maquette) relèvent de PFC-017 ; latence et parité mesurées sans GPU (scène bouchonnée pour la parité d'interface).
- Blocages : aucun. Prochain ticket disponible : PFC-017 (reconnexion).
