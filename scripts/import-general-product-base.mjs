import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

const [, , filePathArg, modeArg] = process.argv;
const sourcePath = filePathArg || "C:/Users/APOIO/Documents/BASE DE DADOS GERAL.xlsx";
const dryRun = modeArg === "--dry-run";

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
  if (!normalized || ["VAZIO", "A DEFINIR", "SEM FAB", "SEM FABRICANTE", "0"].includes(normalized)) return "";
  return normalized;
}

function normalizeCode(value) {
  return String(value || "").replace(/[^\dA-Za-z]/g, "").trim();
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

function parseRows(rows) {
  const [headerRow = [], ...dataRows] = rows;
  const headers = headerRow.map(normalizeHeader);
  const eanIndex = findHeaderIndex(headers, [
    (header) => header.includes("BARRA"),
    (header) => header.includes("EAN"),
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

  const rowsByEan = new Map();
  let skipped = 0;

  for (const row of dataRows) {
    const ean = normalizeCode(row[eanIndex]);
    const description = String(row[descriptionIndex] || "").trim();
    const manufacturer = manufacturerIndex >= 0 ? normalizeAttribute(row[manufacturerIndex]) : "";
    const classification = classificationIndex >= 0 ? normalizeAttribute(row[classificationIndex]) : "";

    if (!ean || !description) {
      skipped += 1;
      continue;
    }

    if (!rowsByEan.has(ean)) {
      rowsByEan.set(ean, {
        ean,
        description: description.toUpperCase().replace(/\s+/g, " ").trim(),
        manufacturer,
        classification,
      });
    } else {
      skipped += 1;
    }
  }

  return { attributes: Array.from(rowsByEan.values()), skipped };
}

const env = readEnv();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Variaveis NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam existir em .env.local.");
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const resolvedPath = path.resolve(sourcePath);
const { attributes, skipped } = parseRows(readWorkbookRows(resolvedPath));
const sourceFile = path.basename(resolvedPath);
const lookupChunkSize = 200;
const upsertChunkSize = 1000;
let matchedProducts = 0;
let updated = 0;
let unmatched = 0;

for (let index = 0; index < attributes.length; index += lookupChunkSize) {
  const chunk = attributes.slice(index, index + lookupChunkSize);
  const eans = chunk.map((row) => row.ean);
  const { data: existingProducts, error } = await supabase
    .from("reallocation_products")
    .select("erp_code,ean,description,manufacturer,classification,source_file")
    .in("ean", eans);

  if (error) throw error;

  const existingRows = existingProducts || [];
  matchedProducts += existingRows.length;
  unmatched += Math.max(0, eans.length - new Set(existingRows.map((product) => product.ean)).size);

  if (dryRun || existingRows.length === 0) continue;

  const attributeByEan = new Map(chunk.map((row) => [row.ean, row]));
  const payload = existingRows.map((product) => {
    const attribute = attributeByEan.get(product.ean);
    const description = attribute?.description || product.description || "";
    const manufacturer = attribute?.manufacturer || product.manufacturer || "";
    const classification = attribute?.classification || product.classification || "";

    return {
      erp_code: product.erp_code,
      ean: product.ean,
      description,
      manufacturer,
      classification,
      search_text: normalizeSearch(product.erp_code, product.ean, description, manufacturer, classification),
      source_file: product.source_file || sourceFile,
    };
  });

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
  uniqueEans: attributes.length,
  skipped,
  matchedProducts,
  updated,
  unmatched,
}, null, 2));
