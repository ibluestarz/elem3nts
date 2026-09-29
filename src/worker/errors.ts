export type RoomStorageErrorCode =
  /** Écrit par une version plus récente du Worker (retour arrière) : jamais réinterprété. */
  | 'SCHEMA_TOO_NEW'
  /** Ligne illisible, migration absente ou état hors schéma. */
  | 'CORRUPT'
  /** Écriture fondée sur une révision périmée : rien n'est écrit. */
  | 'REVISION_CONFLICT'
  /** État à écrire hors schéma : rien n'est écrit. */
  | 'INVALID_STATE';

/** Lecture ou écriture refusée par le stockage d'une room ; l'état persisté reste inchangé. */
export class RoomStorageError extends Error {
  readonly code: RoomStorageErrorCode;

  constructor(code: RoomStorageErrorCode, message: string) {
    super(message);
    this.name = 'RoomStorageError';
    this.code = code;
  }
}
