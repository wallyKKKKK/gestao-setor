import type { SupplierItem } from '@/lib/purchase-quotation-supplier';

const eanHeaders = new Set(['EAN', 'GTIN', 'CODIGODEBARRAS', 'CODIGOBARRAS', 'CODBARRAS', 'BARRAS']);
const priceHeaders = new Set(['CUSTO', 'CUSTOUNITARIO', 'CUSTOUNIT', 'PRECO', 'PRECOUNITARIO', 'PRECOUNIT', 'PRECOCOTADO', 'VALORUNITARIO']);
const header = (value: unknown) => String(value ?? '').normalize('NFD').toUpperCase().replace(/[^A-Z0-9]/g, '');
const blank = (value: unknown) => value == null || String(value).trim() === '';

function readPrice(value: unknown) {
  if (typeof value === 'string') {
    const clean = value.trim().replace(/^R\$\s*/, '');
    if (!/^(?:\d+(?:[.,]\d{1,4})?|\d{1,3}(?:\.\d{3})+,\d{1,4})$/.test(clean)) return null;
    value = Number(clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean);
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.0001 || value > 9999999) return null;
  return Number(value.toFixed(4));
}

export function matchSupplierPrices(grid: unknown[][], items: SupplierItem[], formattedEans?: (row: number, column: number) => unknown) {
  let headerRow = -1, eanColumn = -1, priceColumn = -1;
  for (const [index, row] of grid.entries()) {
    const names = row.map(header);
    const eans = names.flatMap((name, column) => eanHeaders.has(name) ? [column] : []);
    const prices = names.flatMap((name, column) => priceHeaders.has(name) ? [column] : []);
    if (!eans.length || !prices.length) continue;
    if (eans.length > 1 || prices.length > 1) throw new Error('Deixe apenas uma coluna de EAN e uma de Custo na planilha.');
    headerRow = index; eanColumn = eans[0]; priceColumn = prices[0];
    break;
  }
  if (headerRow === -1) throw new Error('A planilha precisa de uma coluna EAN e uma coluna Custo (ou Preço Unitário).');

  const itemsByEan = new Map<string, SupplierItem[]>();
  for (const item of items) {
    const matches = itemsByEan.get(item.ean) ?? [];
    matches.push(item);
    itemsByEan.set(item.ean, matches);
  }
  const pricesByItem = new Map<string, { price: number; line: number }>();
  const conflicts = new Set<string>();
  const examples: string[] = [];
  let ignored = 0;
  const issue = (text: string) => { ignored++; if (examples.length < 15) examples.push(text); };

  for (let index = headerRow + 1; index < grid.length; index++) {
    const rawEan = grid[index][eanColumn];
    const rawPrice = grid[index][priceColumn];
    if (blank(rawEan) && blank(rawPrice)) continue;
    const line = index + 1;
    const formatted = typeof rawEan === 'number' ? String(formattedEans?.(index, eanColumn) ?? '').trim() : '';
    const ean = typeof rawEan === 'number' && /^\d+$/.test(formatted) && Number(formatted) === rawEan
      ? formatted : String(rawEan ?? '').trim();
    if (!/^\d+$/.test(ean) || (typeof rawEan === 'number' && !Number.isSafeInteger(rawEan))) {
      issue(`Linha ${line}: EAN inválido.`);
      continue;
    }
    const matches = itemsByEan.get(ean);
    if (!matches) { issue(`Linha ${line}: EAN ${ean} fora da cotação.`); continue; }
    if (matches.length !== 1) { issue(`Linha ${line}: EAN ${ean} corresponde a mais de um item da cotação.`); continue; }
    const price = readPrice(rawPrice);
    if (price === null) { issue(`Linha ${line}: custo inválido para o EAN ${ean}.`); continue; }
    const id = matches[0].id;
    const previous = pricesByItem.get(id);
    if (conflicts.has(id)) { issue(`Linha ${line}: EAN ${ean} com preços divergentes.`); continue; }
    if (previous && previous.price !== price) {
      conflicts.add(id);
      pricesByItem.delete(id);
      issue(`Linha ${previous.line}: EAN ${ean} com preços divergentes.`);
      issue(`Linha ${line}: EAN ${ean} com preços divergentes.`);
    } else if (previous) {
      issue(`Linha ${line}: EAN ${ean} repetido com o mesmo preço.`);
    } else {
      pricesByItem.set(id, { price, line });
    }
  }
  return { prices: Array.from(pricesByItem, ([itemId, { price }]) => ({ itemId, price })), ignored, examples };
}

export async function readSupplierPriceFile(buffer: ArrayBuffer, filename: string, items: SupplierItem[]) {
  if (!/\.(xlsx|csv)$/i.test(filename)) throw new Error('Envie um arquivo XLSX ou CSV.');
  const xlsx = await import('xlsx');
  let workbook;
  if (/\.csv$/i.test(filename)) {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch { text = new TextDecoder('windows-1252').decode(buffer); }
    workbook = xlsx.read(text, { type: 'string', raw: true, sheetRows: 20002 });
  } else {
    workbook = xlsx.read(buffer, { type: 'array', sheets: 0, sheetRows: 20002 });
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet?.['!ref']) throw new Error('A planilha está vazia.');
  const range = xlsx.utils.decode_range(sheet['!ref']);
  if (range.e.r >= 20000 || range.e.c >= 100) throw new Error('Envie uma planilha com até 20 mil linhas e 100 colunas.');
  // Anchor the grid at A1 so diagnostics and formatted cell coordinates agree.
  const grid = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, range: { s: { r: 0, c: 0 }, e: range.e } });
  return matchSupplierPrices(grid, items, (row, column) => sheet[xlsx.utils.encode_cell({ r: row, c: column })]?.w);
}
