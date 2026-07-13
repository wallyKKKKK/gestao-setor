import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isPerfumePurchasingSector, normalizePermissionSector } from "@/lib/permissions";
import { requireAuthenticatedProfile } from "@/lib/server-auth";

interface CatalogRow {
  erp_code: string;
  ean: string;
  description: string;
  manufacturer: string;
  classification: string;
  search_text: string;
  source_file: string;
}

interface AttributeRow {
  ean: string;
  description: string;
  manufacturer: string;
  classification: string;
}

interface ParsedCatalog {
  rows: CatalogRow[];
  attributes: AttributeRow[];
  skipped: number;
}

function canManageProductCatalog(role: string, sector: string) {
  const normalizedSector = normalizePermissionSector(sector || "");
  return role === "admin"
    || normalizedSector === "price"
    || normalizedSector.startsWith("precificacao")
    || isPerfumePurchasingSector(sector || "");
}

function parseDelimitedRows(csvText: string) {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
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

function normalizeSearch(...values: string[]) {
  return values
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAttribute(value: string) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized || ["VAZIO", "A DEFINIR", "SEM FAB", "SEM FABRICANTE", "0"].includes(normalized)) return "";
  return normalized;
}

function normalizeCategoryLevel(value: string) {
  const normalized = normalizeAttribute(value);
  if (!normalized || normalized === "PRINCIPAL" || /^[.\s-]+$/.test(normalized)) return "";
  return normalized;
}

function normalizeCode(value: string) {
  return value.replace(/[^\dA-Za-z]/g, "").trim();
}

function firstHeaderIndex(headers: string[], matchers: Array<(header: string) => boolean>) {
  for (const matcher of matchers) {
    const index = headers.findIndex(matcher);
    if (index >= 0) return index;
  }
  return -1;
}

function categoryIndexes(headers: string[]) {
  return headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => header.includes("CATEGORIA") && header.includes("NIVEL"))
    .sort((left, right) => left.header.localeCompare(right.header, "pt-BR", { numeric: true }))
    .map(({ index }) => index);
}

function buildClassification(cells: string[], explicitIndex: number, treeIndexes: number[]) {
  if (explicitIndex >= 0) return normalizeAttribute(String(cells[explicitIndex] || ""));

  const levels = treeIndexes
    .map((index) => normalizeCategoryLevel(String(cells[index] || "")))
    .filter(Boolean);

  return Array.from(new Set(levels)).join(" > ");
}

function decodeCsvBuffer(buffer: ArrayBuffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

function parseCatalogRows(inputRows: string[][], sourceFile: string, sourceLabel: string): ParsedCatalog {
  const [headerRow = [], ...dataRows] = inputRows;
  const headers = headerRow.map((header) => normalizeSearch(header));
  const erpIndex = headers.findIndex((header) => header.includes("CODIGO PRODUTO") || header === "CODIGO");
  const descriptionIndex = firstHeaderIndex(headers, [
    (header) => header.includes("DESCRICAO"),
    (header) => header === "PRODUTO",
    (header) => header.includes("PRODUTO"),
  ]);
  const eanIndex = firstHeaderIndex(headers, [
    (header) => header.includes("BARRA"),
    (header) => header.includes("EAN"),
  ]);
  const manufacturerIndex = firstHeaderIndex(headers, [
    (header) => header.includes("FABRICANTE"),
    (header) => header === "MARCA" || header.includes("MARCA"),
    (header) => header.includes("FORNECEDOR"),
  ]);
  const classificationIndex = firstHeaderIndex(headers, [
    (header) => header.includes("CLASSIFICACAO"),
    (header) => header.includes("CLASSIFICAÇÃO"),
  ]);
  const treeIndexes = categoryIndexes(headers);

  if (descriptionIndex < 0 || eanIndex < 0) {
    throw new Error(`${sourceLabel} precisa ter pelo menos as colunas Descricao/Produto e Barra/EAN.`);
  }

  const rows: CatalogRow[] = [];
  const attributes: AttributeRow[] = [];
  const seen = new Set<string>();
  const seenAttributes = new Set<string>();
  let skipped = 0;

  dataRows.forEach((cells) => {
    const erpCode = erpIndex >= 0 ? normalizeCode(String(cells[erpIndex] || "")) : "";
    const description = String(cells[descriptionIndex] || "").trim();
    const ean = normalizeCode(String(cells[eanIndex] || ""));
    const manufacturer = manufacturerIndex >= 0 ? normalizeAttribute(String(cells[manufacturerIndex] || "")) : "";
    const classification = buildClassification(cells, classificationIndex, treeIndexes);

    if (!description || !ean) {
      skipped += 1;
      return;
    }

    if (!erpCode) {
      if (seenAttributes.has(ean)) {
        skipped += 1;
        return;
      }

      seenAttributes.add(ean);
      attributes.push({
        ean,
        description: description.toUpperCase(),
        manufacturer,
        classification,
      });
      return;
    }

    const key = `${erpCode}::${ean}`;
    if (seen.has(key)) {
      skipped += 1;
      return;
    }

    seen.add(key);
    rows.push({
      erp_code: erpCode,
      ean,
      description: description.toUpperCase(),
      manufacturer,
      classification,
      search_text: normalizeSearch(erpCode, ean, description, manufacturer, classification),
      source_file: sourceFile,
    });
  });

  return { rows, attributes, skipped };
}

function parseCatalogCsv(csvText: string, sourceFile: string) {
  return parseCatalogRows(parseDelimitedRows(csvText), sourceFile, "CSV");
}

function parseCatalogWorkbook(buffer: ArrayBuffer, sourceFile: string) {
  const workbook = XLSX.read(Buffer.from(buffer), { type: "buffer", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = sheetName ? workbook.Sheets[sheetName] : null;

  if (!worksheet) {
    throw new Error("Planilha sem abas validas para importar.");
  }

  const rows = XLSX.utils.sheet_to_json<string[]>(worksheet, {
    header: 1,
    defval: "",
    raw: false,
  }).map((row) => row.map((cell) => String(cell || "").trim()));

  return parseCatalogRows(rows, sourceFile, "Planilha");
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;

    if (!canManageProductCatalog(auth.profile.role, auth.profile.sector || "")) {
      return NextResponse.json({ error: "Acesso liberado apenas para Admin, Price ou Compras Perfumaria." }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Envie um arquivo CSV, XLS ou XLSX." }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const lowerName = file.name.toLowerCase();
    const { rows, attributes, skipped } = lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")
      ? parseCatalogWorkbook(buffer, file.name)
      : parseCatalogCsv(decodeCsvBuffer(buffer), file.name);

    if (!rows.length && !attributes.length) {
      return NextResponse.json({ error: "Nenhum produto valido encontrado." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const chunkSize = 1000;
    const enrichmentChunkSize = 200;
    let imported = 0;
    let enriched = 0;
    let unmatched = 0;

    for (let index = 0; index < rows.length; index += chunkSize) {
      const chunk = rows.slice(index, index + chunkSize);
      const { error } = await supabase
        .from("reallocation_products")
        .upsert(chunk, { onConflict: "erp_code,ean" });

      if (error) throw error;
      imported += chunk.length;
    }

    for (let index = 0; index < attributes.length; index += enrichmentChunkSize) {
      const chunk = attributes.slice(index, index + enrichmentChunkSize);
      const eans = Array.from(new Set(chunk.map((row) => row.ean)));
      const { data: existingProducts, error: existingError } = await supabase
        .from("reallocation_products")
        .select("erp_code,ean,description,manufacturer,classification,source_file")
        .in("ean", eans);

      if (existingError) throw existingError;
      unmatched += Math.max(0, eans.length - new Set((existingProducts || []).map((product) => product.ean)).size);

      const attributesByEan = new Map(chunk.map((row) => [row.ean, row]));
      const payload = (existingProducts || []).map((product) => {
        const attribute = attributesByEan.get(product.ean);
        const manufacturer = attribute?.manufacturer || product.manufacturer || "";
        const classification = attribute?.classification || product.classification || "";
        return {
          erp_code: product.erp_code,
          ean: product.ean,
          description: product.description || attribute?.description || "",
          manufacturer,
          classification,
          search_text: normalizeSearch(product.erp_code, product.ean, product.description || attribute?.description || "", manufacturer, classification),
          source_file: product.source_file || file.name,
        };
      });

      if (payload.length > 0) {
        const { error } = await supabase
          .from("reallocation_products")
          .upsert(payload, { onConflict: "erp_code,ean" });

        if (error) throw error;
        enriched += payload.length;
      }
    }

    return NextResponse.json({
      imported,
      enriched,
      unmatched,
      skipped,
      total: rows.length + attributes.length + skipped,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao importar catalogo.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
