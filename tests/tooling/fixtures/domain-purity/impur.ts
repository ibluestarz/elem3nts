// Fixture PFC-002-AC3 : ces API d'environnement doivent être inconnues du projet TypeScript du domaine.
export const titre: string = document.title;
export const minuteur = setTimeout(() => undefined, 0);
export const env = process.env;
