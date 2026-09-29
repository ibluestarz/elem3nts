export type DomainErrorCode = 'MATCH_OVER' | 'MATCH_NOT_OVER';

/**
 * Transition refusée par une garde de phase. L'état d'entrée reste inchangé ; l'appelant
 * (contrôleur local ou serveur) décide d'ignorer ou de rejeter la commande.
 */
export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
