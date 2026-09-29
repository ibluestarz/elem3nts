/**
 * Copie un texte dans le presse-papier. `false` si l'API est absente (contexte non sécurisé,
 * navigateur ancien) ou si le navigateur refuse : l'interface propose alors une copie manuelle.
 * Pas de repli `execCommand('copy')` : API obsolète, au comportement non garanti.
 */
export async function copyText(text: string): Promise<boolean> {
  // Absent hors contexte sécurisé : le type DOM le déclare pourtant toujours présent.
  const clipboard = (navigator as { clipboard?: Clipboard }).clipboard;
  if (typeof clipboard?.writeText !== 'function') return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
