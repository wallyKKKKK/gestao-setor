export interface ReallocationImportIssue {
  line: number;
  storeCode: string;
  storeName: string;
  ean: string;
  product: string;
  reason: string;
}

export interface ReallocationImportReport {
  sourceFile: string;
  sector: string;
  imported: number;
  replacedRows: number;
  matchedProducts: number;
  unmatchedProducts: number;
  skipped: number;
  totalRows: number;
  uniqueProducts: number;
  stores: Array<{ code: string; name: string }>;
  unmatchedItems: ReallocationImportIssue[];
  skippedRows: ReallocationImportIssue[];
  movementColumnsAvailable: boolean;
  erpInventoryWarning: string | null;
}
