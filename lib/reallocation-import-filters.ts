import type { ReallocationImportFilterPreview, ReallocationImportFilterSelection, ReallocationImportReport } from './reallocation-import-report';

export function buildImportFilterPreview(
  rows: Array<{ ean: string }>,
  fileAttributes: Array<{ ean: string; manufacturer: string }>,
  catalog: Map<string, { manufacturer: string }>,
  linkedEans: Set<string>,
): ReallocationImportFilterPreview {
  const attributes = new Map(fileAttributes.map(row => [row.ean, row.manufacturer]));
  const manufacturers = new Map<string, ReallocationImportFilterPreview['manufacturers'][number]>();
  let missingManufacturerRows = 0;
  for (const row of rows) {
    const fromFile = attributes.get(row.ean)?.trim();
    const name = (fromFile || catalog.get(row.ean)?.manufacturer || '').trim().toUpperCase();
    if (!name || name === '-') { missingManufacturerRows++; continue; }
    const current = manufacturers.get(name);
    manufacturers.set(name, { name, source: fromFile || current?.source === 'file' ? 'file' : 'catalog', linked: Boolean(current?.linked || linkedEans.has(row.ean)) });
  }
  return {
    manufacturers: [...manufacturers.values()].sort((left, right) => Number(right.source === 'file') - Number(left.source === 'file') || left.name.localeCompare(right.name, 'pt-BR', { numeric: true })),
    missingManufacturerRows,
  };
}

export function normalizeImportStoreCode(value: string) {
  return value.trim().replace(/^0+(?=\d)/, '').padStart(2, '0');
}

export function initialImportFilterSelection(report: ReallocationImportReport, currentDestinations: string[]): ReallocationImportFilterSelection {
  const stores = [...new Set(report.stores.map(store => normalizeImportStoreCode(store.code)))];
  const destinations = new Set(currentDestinations.map(normalizeImportStoreCode));
  return {
    manufacturers: (report.filterPreview?.manufacturers || []).filter(item => item.linked).map(item => item.name),
    origins: stores,
    destinations: stores.filter(code => destinations.has(code)),
    clearOtherFilters: true,
  };
}
