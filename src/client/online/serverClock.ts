/**
 * Décalage entre l'horloge du serveur et l'horloge monotone du client (`performance.now`), pour
 * interpoler les échéances publiées (ARCHITECTURE : « interpoler l'affichage avec serverNow »).
 *
 * Chaque trame datée par le serveur (`state.serverNow`, `pong.serverNow`) a été émise avant sa
 * réception : `serverNow - reçueÀ` est un minorant du décalage réel, d'autant plus proche que le
 * trajet a été court. L'estimation retenue est le plus grand minorant observé :
 * - elle ne fait qu'augmenter, donc une échéance convertie ne recule jamais dans le temps local et
 *   un décompte ne remonte jamais (AC2 : pas de régression de l'interface) ;
 * - son erreur est bornée par le plus court trajet serveur → client observé (quelques ms avec les
 *   `pong` de mesure de latence).
 * Elle ne décide rien : une échéance atteinte localement n'avance aucune phase, seul un `state`
 * du serveur le fait.
 */
export class ServerClock {
  #offset: number | null = null;

  /** Échantillon : horloge serveur `serverNow` reçue à l'instant local `receivedAt`. */
  sample(serverNow: number, receivedAt: number): void {
    const bound = serverNow - receivedAt;
    if (this.#offset === null || bound > this.#offset) this.#offset = bound;
  }

  /** Décalage estimé (serveur − local), `null` avant le premier échantillon. */
  get offset(): number | null {
    return this.#offset;
  }
}

/** Instant local correspondant à un instant serveur, pour un décalage donné. */
export const toLocalTime = (serverTime: number, offset: number): number => serverTime - offset;
