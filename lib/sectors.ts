export function cleanSectorName(value: string) {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ');
}

export function sectorNameKey(value: string) {
  return cleanSectorName(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

export function validateSectorName(value: string) {
  const name = cleanSectorName(value);
  return name.length < 2 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)
    ? 'Informe um nome entre 2 e 80 caracteres.' : '';
}

export function mergeSectorNames(...groups: string[][]) {
  const names = new Map<string, string>();
  for (const name of groups.flat()) {
    const cleaned = cleanSectorName(name);
    if (cleaned && !names.has(sectorNameKey(cleaned))) names.set(sectorNameKey(cleaned), cleaned);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
