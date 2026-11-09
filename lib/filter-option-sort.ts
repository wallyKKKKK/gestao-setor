export type FilterOptionSort = { index: number; direction: 'asc' | 'desc' } | null;

export function nextFilterOptionSort(current: FilterOptionSort, index: number): FilterOptionSort {
  return { index, direction: current?.index === index && current.direction === 'asc' ? 'desc' : 'asc' };
}

export function sortFilterOptions<T extends { columns: string[] }>(items: T[], sort: FilterOptionSort): T[] {
  if (!sort) return items;
  const factor = sort.direction === 'asc' ? 1 : -1;
  return [...items].sort((left, right) => (left.columns[sort.index] || '').localeCompare(right.columns[sort.index] || '', 'pt-BR', {
    numeric: true, sensitivity: 'base',
  }) * factor);
}
