export function expiringClassificationParts(path: string) {
  const parts = path.split('>').map(part => part.trim().replace(/\s+/g, ' ').toUpperCase()).filter(Boolean);
  const useful = parts[0] === 'PRINCIPAL' ? parts.slice(1) : parts;
  return {
    line: useful[0] || '',
    department: useful[1] || '',
    category: useful[2] || useful[useful.length - 1] || '',
  };
}
