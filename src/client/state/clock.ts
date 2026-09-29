/** Horloge monotone de l'application ; les tests la remplacent par une horloge factice. */
export const now = (): number => performance.now();
