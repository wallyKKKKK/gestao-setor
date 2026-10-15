export function readHiddenTableColumns<Key extends string>(value: unknown, available: readonly { key: Key }[]): Key[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set(available.map((column) => column.key));
  const hidden = [...new Set(value.filter((key): key is Key => typeof key === 'string' && valid.has(key as Key)))];
  return hidden.length === available.length ? hidden.slice(0, -1) : hidden;
}
