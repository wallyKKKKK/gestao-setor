import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fileArgs = args.filter((arg) => !arg.startsWith("--"));
const sourcePath = fileArgs[0] || "C:/Users/APOIO/Documents/BASE DE DADOS GERAL.xlsx";
const treePath = fileArgs[1] || "";

function readEnv() {
  const envText = fs.readFileSync(".env.local", "utf8");
  return Object.fromEntries(
    envText
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.trim().startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
      }),
  );
}

function normalizeSearch(...values) {
  return values
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAttribute(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!normalized || ["VAZIO", "A DEFINIR", "SEM FAB", "SEM FABRICANTE", "0", ".", "..", "...", "-------------"].includes(normalized)) return "";
  return normalized;
}

function normalizeCode(value) {
  return String(value || "").replace(/[^\dA-Za-z]/g, "").trim();
}

function normalizeCodeKey(value) {
  const code = normalizeCode(value);
  return code.replace(/^0+(?=\d)/, "") || code;
}

function normalizeHeader(value) {
  return normalizeSearch(String(value || ""));
}

function findHeaderIndex(headers, matchers) {
  for (const matcher of matchers) {
    const index = headers.findIndex(matcher);
    if (index >= 0) return index;
  }
  return -1;
}

function readWorkbookRows(filePath) {
  if (/\.csv$/i.test(filePath)) {
    return parseDelimitedRows(fs.readFileSync(filePath, "utf8"));
  }

  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!worksheet) throw new Error("Planilha sem abas validas.");

  return XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
    raw: false,
  });
}

function parseDelimitedRows(csvText) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;
  const text = csvText.replace(/^\uFEFF/, "");

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ";" && !inQuotes) {
      row.push(current.trim());
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current.trim());
      if (row.some((cell) => cell)) rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current.trim());
  if (row.some((cell) => cell)) rows.push(row);
  return rows;
}

function cellByHeader(row, headerIndexByName, name) {
  const index = headerIndexByName.get(normalizeHeader(name));
  return index === undefined ? "" : row[index];
}

function looksUsefulText(value) {
  const normalized = normalizeAttribute(value);
  return Boolean(normalized && /[A-Z0-9]/.test(normalized) && normalized.length >= 2);
}

function normalizeDescription(value) {
  const description = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!looksUsefulText(description)) return "";
  return description;
}

function classificationPathFromTree(row, headerIndexByName) {
  const rawLevels = [1, 2, 3, 4, 5]
    .map((level) => normalizeAttribute(cellByHeader(row, headerIndexByName, `categoria_nivel_${level}`)))
    .filter(Boolean);

  const principalIndex = rawLevels.findIndex((level) => level === "PRINCIPAL");
  const levels = principalIndex >= 0 ? rawLevels.slice(principalIndex) : rawLevels;
  return levels.join(" > ");
}

function parseTreeRows(rows) {
  const [headerRow = [], ...dataRows] = rows;
  const headers = headerRow.map(normalizeHeader);
  const headerIndexByName = new Map(headers.map((header, index) => [header, index]));
  const barcodeIndex = findHeaderIndex(headers, [
    (header) => header.includes("CODIGOBARRA"),
    (header) => header.includes("BARRA"),
    (header) => header.includes("EAN"),
  ]);

  if (barcodeIndex < 0) {
    throw new Error("A arvore mercadologica precisa ter coluna codigobarra.");
  }

  const rowsByBarcode = new Map();
  let skipped = 0;

  for (const row of dataRows) {
    const barcode = normalizeCode(row[barcodeIndex]);
    const key = normalizeCodeKey(barcode);
    if (!key) {
      skipped += 1;
      continue;
    }

    const description = normalizeDescription(cellByHeader(row, headerIndexByName, "descricao"));
    const manufacturer = normalizeAttribute(cellByHeader(row, headerIndexByName, "marca"))
      || normalizeAttribute(cellByHeader(row, headerIndexByName, "nom_fornecedor"))
      || normalizeAttribute(cellByHeader(row, headerIndexByName, "nom_rede"));
    const classification = classificationPathFromTree(row, headerIndexByName);

    if (!rowsByBarcode.has(key) || (description && !rowsByBarcode.get(key).description)) {
      rowsByBarcode.set(key, {
        barcode,
        description,
        manufacturer,
        classification,
      });
    }
  }

  return { rowsByBarcode, skipped };
}

function parseRows(rows) {
  const [headerRow = [], ...dataRows] = rows;
  const headers = headerRow.map(normalizeHeader);
  const headerIndexByName = new Map(headers.map((header, index) => [header, index]));
  const erpIndex = findHeaderIndex(headers, [
    (header) => header === "CODIGO PRODUTO",
    (header) => header.includes("CODIGO PRODUTO"),
    (header) => header.includes("CODIGO ERP"),
    (header) => header === "ERP",
  ]);
  const eanIndex = findHeaderIndex(headers, [
    (header) => header.includes("BARRA"),
    (header) => header.includes("EAN"),
    (header) => header.includes("ETIQUETA"),
  ]);
  const labelIndex = findHeaderIndex(headers, [
    (header) => header.includes("ETIQUETA"),
  ]);
  const descriptionIndex = findHeaderIndex(headers, [
    (header) => header.includes("DESCRICAO"),
    (header) => header === "PRODUTO",
    (header) => header.includes("PRODUTO"),
  ]);
  const manufacturerIndex = findHeaderIndex(headers, [
    (header) => header.includes("FABRICANTE"),
    (header) => header.includes("MARCA"),
    (header) => header.includes("FORNECEDOR"),
  ]);
  const classificationIndex = findHeaderIndex(headers, [
    (header) => header.includes("CLASSIFICACAO"),
  ]);

  if (eanIndex < 0 || descriptionIndex < 0) {
    throw new Error("A planilha precisa ter colunas de EAN/Cod. de Barras e Produto/Descricao.");
  }

  const rowsByKey = new Map();
  let skipped = 0;

  for (const row of dataRows) {
    const erpCode = erpIndex >= 0 ? normalizeCode(row[erpIndex]) : "";
    const ean = normalizeCode(row[eanIndex]) || (labelIndex >= 0 ? normalizeCode(row[labelIndex]) : "");
    const description = normalizeDescription(row[descriptionIndex]);
    const manufacturer = manufacturerIndex >= 0 ? normalizeAttribute(row[manufacturerIndex]) : "";
    const classification = classificationIndex >= 0 ? normalizeAttribute(row[classificationIndex]) : "";
    const key = erpCode || normalizeCodeKey(ean);

    if (!key || (!ean && !erpCode)) {
      skipped += 1;
      continue;
    }

    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, {
        erp_code: erpCode,
        ean,
        ean_keys: Array.from(new Set([
          normalizeCodeKey(ean),
          normalizeCodeKey(labelIndex >= 0 ? row[labelIndex] : ""),
          normalizeCodeKey(cellByHeader(row, headerIndexByName, "Barra")),
          normalizeCodeKey(cellByHeader(row, headerIndexByName, "Etiqueta")),
        ].filter(Boolean))),
        description,
        manufacturer,
        classification,
      });
    } else {
      skipped += 1;
    }
  }

  return { attributes: Array.from(rowsByKey.values()), skipped };
}

function enrichWithTree(productAttributes, treeRowsByBarcode) {
  if (!treeRowsByBarcode.size) return productAttributes;

  return productAttributes.map((product) => {
    const treeRow = product.ean_keys
      .map((key) => treeRowsByBarcode.get(key))
      .find(Boolean);

    if (!treeRow) return product;

    return {
      ...product,
      ean: product.ean || treeRow.barcode,
      description: treeRow.description || product.description,
      manufacturer: treeRow.manufacturer || product.manufacturer,
      classification: treeRow.classification || product.classification,
    };
  });
}

const env = readEnv();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Variaveis NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam existir em .env.local.");
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const resolvedPath = path.resolve(sourcePath);
const treeResolvedPath = treePath ? path.resolve(treePath) : "";
const parsedProducts = parseRows(readWorkbookRows(resolvedPath));
const parsedTree = treeResolvedPath ? parseTreeRows(readWorkbookRows(treeResolvedPath)) : { rowsByBarcode: new Map(), skipped: 0 };
const attributes = enrichWithTree(parsedProducts.attributes, parsedTree.rowsByBarcode);
const skipped = parsedProducts.skipped + parsedTree.skipped;
const sourceFile = treeResolvedPath
  ? `${path.basename(resolvedPath)} + ${path.basename(treeResolvedPath)}`
  : path.basename(resolvedPath);
const importChunkSize = 1000;
const upsertChunkSize = 200;
let matchedProducts = 0;
let updated = 0;
let unmatched = 0;
let insertedByErp = 0;

async function fetchExistingProducts() {
  const rows = [];
  const pageSize = 1000;
  let lastId = "";

  for (;;) {
    let query = supabase
      .from("reallocation_products")
      .select("id,erp_code,ean,description,manufacturer,classification,source_file")
      .order("id", { ascending: true })
      .limit(pageSize);

    if (lastId) query = query.gt("id", lastId);

    const { data, error } = await query;
    if (error) throw error;

    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;

    const nextLastId = chunk[chunk.length - 1]?.id;
    if (!nextLastId || nextLastId === lastId) break;
    lastId = nextLastId;
  }

  return rows;
}

const existingProducts = await fetchExistingProducts();
const existingByErp = new Map();
const existingByEan = new Map();

for (const product of existingProducts) {
  if (product.erp_code) {
    existingByErp.set(product.erp_code, [...(existingByErp.get(product.erp_code) || []), product]);
  }

  const eanKey = normalizeCodeKey(product.ean);
  if (eanKey) {
    existingByEan.set(eanKey, [...(existingByEan.get(eanKey) || []), product]);
  }
}

for (let index = 0; index < attributes.length; index += importChunkSize) {
  const chunk = attributes.slice(index, index + importChunkSize);
  const payloadByKey = new Map();

  for (const attribute of chunk) {
    const existingRowsByKey = new Map();
    (existingByErp.get(attribute.erp_code) || []).forEach((product) => existingRowsByKey.set(`${product.erp_code}:${product.ean}`, product));
    (attribute.ean_keys || []).forEach((key) => {
      (existingByEan.get(key) || []).forEach((product) => existingRowsByKey.set(`${product.erp_code}:${product.ean}`, product));
    });

    const existingRows = Array.from(existingRowsByKey.values());
    matchedProducts += existingRows.length;

    if (existingRows.length === 0) {
      unmatched += 1;
      continue;
    }

    if (dryRun) continue;

    for (const product of existingRows) {
      const description = attribute.description || product.description || "";
      const manufacturer = attribute.manufacturer || product.manufacturer || "";
      const classification = attribute.classification || product.classification || "";

      payloadByKey.set(`${product.erp_code}:${product.ean}`, {
        erp_code: product.erp_code,
        ean: product.ean,
        description,
        manufacturer,
        classification,
        search_text: normalizeSearch(product.erp_code, product.ean, description, manufacturer, classification),
        source_file: product.source_file || sourceFile,
      });
    }

    if (attribute.erp_code && attribute.ean && existingByErp.has(attribute.erp_code)) {
      const canonicalExists = (existingByErp.get(attribute.erp_code) || []).some((product) => (
        normalizeCodeKey(product.ean) === normalizeCodeKey(attribute.ean)
      ));

      if (!canonicalExists) {
        payloadByKey.set(`${attribute.erp_code}:${attribute.ean}`, {
          erp_code: attribute.erp_code,
          ean: attribute.ean,
          description: attribute.description || "",
          manufacturer: attribute.manufacturer || "",
          classification: attribute.classification || "",
          search_text: normalizeSearch(attribute.erp_code, attribute.ean, attribute.description, attribute.manufacturer, attribute.classification),
          source_file: sourceFile,
        });
        insertedByErp += 1;
      }
    }
  }

  const payload = Array.from(payloadByKey.values());

  if (dryRun || payload.length === 0) continue;

  for (let payloadIndex = 0; payloadIndex < payload.length; payloadIndex += upsertChunkSize) {
    const payloadChunk = payload.slice(payloadIndex, payloadIndex + upsertChunkSize);
    const { error: upsertError } = await supabase
      .from("reallocation_products")
      .upsert(payloadChunk, { onConflict: "erp_code,ean" });

    if (upsertError) throw upsertError;
    updated += payloadChunk.length;
  }
}

console.log(JSON.stringify({
  file: sourceFile,
  mode: dryRun ? "dry-run" : "update",
  uniqueRows: attributes.length,
  treeRows: parsedTree.rowsByBarcode.size,
  skipped,
  matchedProducts,
  updated,
  insertedByErp: dryRun ? 0 : insertedByErp,
  unmatched,
}, null, 2));
