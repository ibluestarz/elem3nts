import { deepFreeze, isJsonObject, type JsonObject } from '../shared/protocol/index.ts';
import { ROOM_SCHEMA_VERSION, isPersistedRoom, type PersistedRoom } from './codec.ts';
import { RoomStorageError } from './errors.ts';

/** Migrations successives : `MIGRATIONS[n]` transforme un état de version `n` en version `n + 1`. */
const MIGRATIONS: Readonly<Partial<Record<number, (state: unknown) => unknown>>> = Object.freeze({
  /**
   * v1 → v2 : une room v1 n'a jamais émis de token ; personne ne peut donc s'y authentifier ni la
   * rejoindre. Elle reçoit deux places vides, aucune présence ni confirmation, et `createdAt = 0`
   * (création inconnue) : la durée maximale (D16, PFC-018) la fermera au premier traitement.
   */
  1: (state: unknown): unknown =>
    isJsonObject(state)
      ? { ...state, ready: [false, false], connected: [false, false], createdAt: 0, seats: [null, null] }
      : state,
  /**
   * v2 → v3 (PFC-014) : aucune partie n'a pu être jouée avant PFC-014 ; aucune n'est donc réglée ni
   * aucune réponse mémorisée.
   */
  2: (state: unknown): unknown => (isJsonObject(state) ? { ...state, settledMatchId: null, replies: [[], []] } : state),
  /**
   * v3 → v4 (PFC-017) : aucune pause n'existait (une room v3 en `paused` reste hors schéma : échec
   * fermé). Une place déjà connectée puis absente reçoit une échéance de reconnexion déjà échue (`0`) :
   * l'instant de son départ est inconnu, la room est donc fermée sans trophée au premier traitement,
   * plutôt que de continuer une partie sans l'absent ou de lui inventer un délai.
   */
  3: (state: unknown): unknown =>
    isJsonObject(state) ? { ...state, reconnectDeadline: hasAbsentSeat(state) ? 0 : null, resumeRemainingMs: null } : state,
  /**
   * v4 → v5 (PFC-018) : aucune activité n'était datée. La dernière activité connue est la création
   * (`createdAt`) : rien n'est inventé ; une room créée depuis plus de 30 min est fermée (`inactive`) au
   * premier traitement, une room v1 migrée (`createdAt = 0`) l'est par sa durée maximale.
   */
  4: (state: unknown): unknown => (isJsonObject(state) ? { ...state, lastActivityAt: state['createdAt'] } : state),
});

/** Place authentifiée au moins une fois (réservation levée) et marquée absente, dans un état v3 brut. */
function hasAbsentSeat(state: JsonObject): boolean {
  const { seats, connected } = state;
  if (!Array.isArray(seats) || !Array.isArray(connected)) return false;
  return seats.some((seat: unknown, slot) => isJsonObject(seat) && seat['reservedUntil'] === null && connected[slot] === false);
}

/**
 * Une seule ligne par Durable Object (`id = 1`) : l'état complet de la room, en JSON. La table n'est
 * créée qu'à la première écriture : relire une room absente (join sur un code inconnu) n'alloue rien.
 */
const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS room_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL
)`;

type RoomRow = Record<string, SqlStorageValue> & {
  schema_version: SqlStorageValue;
  revision: SqlStorageValue;
  state: SqlStorageValue;
};

/**
 * Stockage versionné d'une room sur l'API SQLite synchrone du Durable Object. Aucun cache ni
 * état global : chaque instance relit la ligne persistée, seule source de vérité au réveil.
 * Après `deleteAll()` (room fermée), la table n'existe plus et la room se relit absente.
 */
export class RoomStore {
  readonly #storage: DurableObjectStorage;

  constructor(storage: DurableObjectStorage) {
    this.#storage = storage;
  }

  /** État persisté, migré vers le schéma courant et gelé ; `null` si la room n'a jamais été écrite. */
  load(): PersistedRoom | null {
    const row = this.#read();
    return row === null ? null : decode(row);
  }

  /**
   * Écrit `next` si la révision persistée vaut encore `expectedRevision` (`null` : aucune écriture
   * antérieure) et si `next.revision` la dépasse. Vérification et écriture forment une seule
   * transaction : en cas de refus, rien n'est écrit. Rend l'état tel qu'il sera relu au réveil.
   */
  save(next: PersistedRoom, expectedRevision: number | null): PersistedRoom {
    const state = JSON.stringify(next);
    const stored: unknown = JSON.parse(state);
    if (!isPersistedRoom(stored)) throw new RoomStorageError('INVALID_STATE', 'État de room hors schéma.');
    if (expectedRevision !== null && stored.revision <= expectedRevision) {
      throw new RoomStorageError('REVISION_CONFLICT', 'La révision écrite doit dépasser la révision attendue.');
    }
    this.#storage.transactionSync(() => {
      this.#storage.sql.exec(CREATE_TABLE);
      const row = this.#read();
      const persisted = row === null ? null : row.revision;
      if (persisted !== expectedRevision) {
        throw new RoomStorageError('REVISION_CONFLICT', 'Révision persistée différente de la révision attendue.');
      }
      this.#storage.sql.exec(
        `INSERT INTO room_state (id, schema_version, revision, state) VALUES (1, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET schema_version = excluded.schema_version,
           revision = excluded.revision, state = excluded.state`,
        ROOM_SCHEMA_VERSION,
        stored.revision,
        state,
      );
    });
    return deepFreeze(stored);
  }

  #read(): RoomRow | null {
    const table = this.#storage.sql
      .exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'room_state'")
      .toArray();
    if (table.length === 0) return null;
    const rows = this.#storage.sql
      .exec<RoomRow>('SELECT schema_version, revision, state FROM room_state WHERE id = 1')
      .toArray();
    return rows[0] ?? null;
  }
}

function decode(row: RoomRow): PersistedRoom {
  const { schema_version: version, revision, state } = row;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    throw new RoomStorageError('CORRUPT', 'Version de schéma illisible.');
  }
  if (version > ROOM_SCHEMA_VERSION) {
    throw new RoomStorageError('SCHEMA_TOO_NEW', 'État écrit par une version plus récente du Worker.');
  }
  if (typeof state !== 'string') throw new RoomStorageError('CORRUPT', 'État de room illisible.');
  let value: unknown;
  try {
    value = JSON.parse(state);
  } catch {
    throw new RoomStorageError('CORRUPT', 'État de room illisible.');
  }
  for (let from = version; from < ROOM_SCHEMA_VERSION; from += 1) {
    const migrate = MIGRATIONS[from];
    if (migrate === undefined) throw new RoomStorageError('CORRUPT', 'Migration de schéma absente.');
    value = migrate(value);
  }
  if (!isPersistedRoom(value) || value.revision !== revision) {
    throw new RoomStorageError('CORRUPT', 'État de room hors schéma.');
  }
  return deepFreeze(value);
}
