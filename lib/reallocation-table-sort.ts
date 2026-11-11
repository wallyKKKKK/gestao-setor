type Direction = 'asc' | 'desc';
export type ReallocationSortRule<Key extends string> = { key: Key; direction: Direction };

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

export function readReallocationSort<Key extends string>(stored: unknown, validKeys: ReadonlySet<Key>): ReallocationSortRule<Key>[] {
  const rules: ReallocationSortRule<Key>[] = [];
  for (const candidate of Array.isArray(stored) ? stored : [stored]) {
    if (!candidate || typeof candidate !== 'object') continue;
    const { key, direction } = candidate as { key?: Key; direction?: unknown };
    if (!key || !validKeys.has(key) || rules.some(rule => rule.key === key)) continue;
    if (direction !== 'asc' && direction !== 'desc') continue;
    rules.push({ key, direction });
    if (rules.length === 2) break;
  }
  return rules;
}

export function nextReallocationSort<Key extends string>(
  current: ReallocationSortRule<Key>[], key: Key, direction?: Direction,
): ReallocationSortRule<Key>[] {
  const previous = current.find(rule => rule.key === key);
  const rule = { key, direction: direction ?? (previous?.direction === 'asc' ? 'desc' : 'asc') } as const;
  return previous ? current.map(item => item.key === key ? rule : item) : [...current.slice(0, 1), rule];
}

export function sortReallocationRows<Row, Key extends string>(
  rows: Row[], rules: ReallocationSortRule<Key>[], getValue: (row: Row, key: Key) => string | number,
): Row[] {
  if (!rules.length) return rows;
  return [...rows].sort((left, right) => {
    for (const { key, direction } of rules) {
      const a = getValue(left, key);
      const b = getValue(right, key);
      const comparison = typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b));
      if (comparison) return direction === 'asc' ? comparison : -comparison;
    }
    return 0;
  });
}
