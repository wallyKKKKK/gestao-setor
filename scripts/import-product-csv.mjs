import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';

const sourcePath = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
if (!sourcePath) throw new Error('Informe o caminho do CSV');
const apply = process.argv.includes('--apply');
const bytes = fs.readFileSync(sourcePath);
let text;
let encoding = 'utf-8';
try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
catch { encoding = 'windows-1252'; text = new TextDecoder(encoding).decode(bytes); }
const workbook = XLSX.read(text, { type: 'string', raw: true, FS: ';' });
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: true, defval: '', blankrows: false });
const normalize = (value) => String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
const search = (...values) => normalize(values.join(' ')).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const headers = rows[0].map((value) => search(value));
const erpIndex = headers.indexOf('CODIGO PRODUTO');
const descriptionIndex = headers.indexOf('DESCRICAO');
const eanIndex = headers.indexOf('BARRA');
const statusIndex = headers.indexOf('STATUS');
if ([erpIndex, descriptionIndex, eanIndex].some((index) => index < 0)) throw new Error('Colunas Codigo Produto, Descricao e Barra obrigatorias');
const input = new Map();
const conflicts = new Set();
const conflictingPairs = new Set();
const skipped = { missingErp: 0, invalidEan: 0, invalidDescription: 0, duplicate: 0 };
let scientificBarcodes = 0;
const statuses = {};
for (const row of rows.slice(1)) {
  const status = normalize(row[statusIndex]);
  statuses[status] = (statuses[status] || 0) + 1;
  const erp = String(row[erpIndex] ?? '').trim();
  const ean = String(row[eanIndex] ?? '').trim();
  const description = normalize(row[descriptionIndex]);
  if (!/^[0-9A-Za-z]+$/.test(erp)) { skipped.missingErp++; continue; }
  const exactEan = /^\d+$/.test(ean) && /[1-9]/.test(ean) ? ean : '';
  const scientific = /^\d+(?:[.,]\d+)?[eE]\+?\d+$/.test(ean);
  if (scientific) scientificBarcodes++;
  if (!exactEan && !scientific && ean) { skipped.invalidEan++; continue; }
  if (!/[A-Z\u00c0-\u00ff]/i.test(description) || description.includes('\ufffd')) { skipped.invalidDescription++; continue; }
  if (input.has(erp)) {
    const current = input.get(erp);
    if (current.description !== description) conflicts.add(erp);
    if (exactEan && !current.eans.includes(exactEan)) {
      current.eans.push(exactEan);
      current.descriptionsByEan.set(exactEan, description);
    } else {
      if (exactEan && current.descriptionsByEan.get(exactEan) !== description) conflictingPairs.add(`${erp}:${exactEan}`);
      skipped.duplicate++;
    }
  } else {
    input.set(erp, { erp_code: erp, eans: exactEan ? [exactEan] : [], description, descriptionsByEan: new Map(exactEan ? [[exactEan, description]] : []) });
  }
}
console.log(JSON.stringify({ file: path.basename(sourcePath), encoding, totalRows: rows.length - 1, validErpProducts: input.size, scientificBarcodes, conflictingErpProducts: conflicts.size, conflictingExactPairs: conflictingPairs.size, skipped, statuses, mode: apply ? 'apply' : 'dry-run' }));
if (input.size === 0) throw new Error('Nenhum produto valido no CSV');
if (process.argv.includes('--inspect-only')) process.exit(0);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Execute com node --env-file=.env.local');
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function readCatalog() {
  const bounds = ['00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-000000000000', '80000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-000000000000'];
  const groups = await Promise.all(bounds.map(async (lower, index) => {
    const output = [];
    let cursor = '';
    for (;;) {
      let query = supabase.from('reallocation_products').select('id,erp_code,ean,description,manufacturer,classification,search_text,source_file,imported_at')
        .gte('id', lower).order('id', { ascending: true }).limit(1000);
      if (bounds[index + 1]) query = query.lt('id', bounds[index + 1]);
      if (cursor) query = query.gt('id', cursor);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      output.push(...data);
      if (data.length < 1000) break;
      const next = data[data.length - 1].id;
      if (next <= cursor) throw new Error('Cursor invalido na leitura do catalogo');
      cursor = next;
    }
    return output;
  }));
  return groups.flat();
}

const before = await readCatalog();
const byPair = new Map(before.map((row) => [`${row.erp_code}:${row.ean}`, row]));
const byErp = new Map();
for (const row of before) {
  if (!byErp.has(row.erp_code)) byErp.set(row.erp_code, []);
  byErp.get(row.erp_code).push(row);
}
const inherit = (erp, field) => {
  const values = [...new Set((byErp.get(erp) || []).map((row) => row[field]).filter(Boolean))];
  return values.length === 1 ? values[0] : '';
};
const updated = [];
const inserted = [];
const backup = [];
let unchanged = 0;
let newProductsWithoutExactBarcode = 0;
let ambiguousExistingPreserved = 0;
const importedAt = new Date().toISOString();
for (const row of input.values()) {
  const existingRows = byErp.get(row.erp_code) || [];
  if (existingRows.length === 0 && row.eans.length === 0) newProductsWithoutExactBarcode++;
  if (conflicts.has(row.erp_code)) ambiguousExistingPreserved += existingRows.filter((existing) => !row.eans.includes(existing.ean)).length;
  for (const existing of conflicts.has(row.erp_code) ? [] : existingRows) {
    const searchText = search(existing.erp_code, existing.ean, row.description, existing.manufacturer || '', existing.classification || '');
    if (existing.description === row.description && existing.search_text === searchText) { unchanged++; continue; }
    const payload = { erp_code: existing.erp_code, ean: existing.ean, description: row.description, search_text: searchText, source_file: path.basename(sourcePath), imported_at: importedAt };
    // Omitted metadata columns remain untouched by ON CONFLICT UPDATE.
    updated.push(payload);
    backup.push(existing);
  }
  for (const ean of row.eans) {
    const pair = `${row.erp_code}:${ean}`;
    if (conflictingPairs.has(pair)) continue;
    const description = row.descriptionsByEan.get(ean);
    const existing = byPair.get(pair);
    if (existing) {
      if (conflicts.has(row.erp_code)) {
        const searchText = search(row.erp_code, ean, description, existing.manufacturer || '', existing.classification || '');
        if (existing.description === description && existing.search_text === searchText) unchanged++;
        else {
          updated.push({ erp_code: row.erp_code, ean, description, search_text: searchText, source_file: path.basename(sourcePath), imported_at: importedAt });
          backup.push(existing);
        }
      }
      continue;
    }
    const manufacturer = inherit(row.erp_code, 'manufacturer');
    const classification = inherit(row.erp_code, 'classification');
    inserted.push({ erp_code: row.erp_code, ean, description, search_text: search(row.erp_code, ean, description, manufacturer, classification), source_file: path.basename(sourcePath), imported_at: importedAt, manufacturer, classification });
  }
}
console.log(JSON.stringify({ catalogBefore: before.length, toUpdate: updated.length, toInsert: inserted.length, unchanged, newProductsWithoutExactBarcode, ambiguousExistingPreserved }));
if (!apply) process.exit(0);
const backupPath = path.join(os.tmpdir(), `gestao-products-before-${Date.now()}.json`);
fs.writeFileSync(backupPath, JSON.stringify({ sourceFile: path.basename(sourcePath), previousRows: backup, insertedPairs: inserted.map((row) => [row.erp_code, row.ean]) }));
console.log(`Backup local preservado: ${backupPath}`);
async function writeBatch(name, batch, ignoreDuplicates) {
  const { data: written, error } = await supabase.from('reallocation_products').upsert(batch, { onConflict: 'erp_code,ean', ignoreDuplicates }).select('erp_code,ean,manufacturer,classification');
  if (error?.code === '57014' && batch.length > 1) {
    const middle = Math.ceil(batch.length / 2);
    await writeBatch(name, batch.slice(0, middle), ignoreDuplicates);
    await writeBatch(name, batch.slice(middle), ignoreDuplicates);
    return;
  }
  if (error) throw new Error(`${name}: ${error.message}`);
  for (const row of written || []) {
    const previous = byPair.get(`${row.erp_code}:${row.ean}`);
    if (previous && (row.manufacturer !== previous.manufacturer || row.classification !== previous.classification)) throw new Error('A verificacao de metadados do lote falhou; consulte o backup local');
  }
}
for (const [name, payload, ignoreDuplicates] of [['updates', updated, false], ['inserts', inserted, true]]) {
  for (let index = 0; index < payload.length; index += 25) {
    await writeBatch(name, payload.slice(index, index + 25), ignoreDuplicates);
    if (index % 250 === 0 || index + 25 >= payload.length) console.log(`${name}: ${Math.min(index + 25, payload.length)}/${payload.length}`);
  }
}
const after = await readCatalog();
const afterByPair = new Map(after.map((row) => [`${row.erp_code}:${row.ean}`, row]));
let invalid = 0;
for (const row of [...updated, ...inserted]) if (afterByPair.get(`${row.erp_code}:${row.ean}`)?.description !== row.description) invalid++;
for (const previous of before) {
  const current = afterByPair.get(`${previous.erp_code}:${previous.ean}`);
  if (!current || current.manufacturer !== previous.manufacturer || current.classification !== previous.classification) throw new Error('A verificacao de preservacao dos dados existentes falhou');
}
if (invalid) throw new Error(`${invalid} produtos divergentes apos a importacao`);
console.log(JSON.stringify({ completed: true, updated: updated.length, inserted: inserted.length, unchanged, catalogAfter: after.length, skipped, scientificBarcodes, conflictingErpProducts: conflicts.size, conflictingExactPairs: conflictingPairs.size, newProductsWithoutExactBarcode, ambiguousExistingPreserved, verified: updated.length + inserted.length, metadataPreserved: true }));
