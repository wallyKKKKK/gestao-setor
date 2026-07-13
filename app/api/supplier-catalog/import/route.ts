import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { normalizePermissionSector } from "@/lib/permissions";
import { parseLocaleNumber } from "@/lib/number";
import { requireAuthenticatedProfile } from "@/lib/server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

interface SupplierCatalogRow {
  supplier_name: string;
  source_system: string;
  source_file: string;
  row_key: string;
  ean: string;
  supplier_sku: string;
  description: string;
  manufacturer: string;
  category: string;
  delivery_type: string;
  available_stock: number;
  price_nf: number;
  list_price: number;
  discount_percent: number;
  st_value: number;
  minimum_quantity: number;
  offer_type: string;
  offer_valid_until: string | null;
  is_active: boolean;
  imported_by: string;
  imported_at: string;
}

function canManageSupplierCatalog(role: string, sector: string) {
  return role === "admin" || normalizePermissionSector(sector).startsWith("compras");
}

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeader(value: string) {
  return normalizeText(value).replace(/[^A-Z0-9]+/g, " ").trim();
}

function normalizeCode(value: string) {
  return String(value || "").replace(/[^\dA-Za-z]/g, "").trim();
}

function normalizeSupplier(value: string) {
  return normalizeText(value).slice(0, 120);
}

function parseNumber(value: string) {
  return parseLocaleNumber(value);
}

function parseDateValue(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const brMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!brMatch) return null;

  const day = brMatch[1].padStart(2, "0");
  const month = brMatch[2].padStart(2, "0");
  const year = brMatch[3].length === 2 ? `20${brMatch[3]}` : brMatch[3];
  return `${year}-${month}-${day}`;
}

function parseDelimitedRows(csvText: string) {
  const delimiter = (csvText.split("\n")[0]?.match(/;/g)?.length || 0) >= (csvText.split("\n")[0]?.match(/,/g)?.length || 0) ? ";" : ",";
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

    if (char === delimiter && !inQuotes) {
      row.push(current.trim());
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function decodeBuffer(buffer: ArrayBuffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

function workbookRows(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false, raw: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("A planilha nao possui abas.");
  const sheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false })
    .map((row) => row.map((cell) => String(cell || "").trim()));
}

function rowsFromFile(fileName: string, buffer: ArrayBuffer) {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) return workbookRows(buffer);
  if (lowerName.endsWith(".csv") || lowerName.endsWith(".txt")) return parseDelimitedRows(decodeBuffer(buffer));
  throw new Error("Envie CSV, TXT, XLS ou XLSX.");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findHeader(headers: string[], aliases: string[]) {
  let bestIndex = -1;
  let bestScore = 0;

  headers.forEach((header, index) => {
    aliases.forEach((alias) => {
      const normalizedAlias = normalizeHeader(alias);
      if (!normalizedAlias) return;
      const isExact = header === normalizedAlias;
      // Casa como palavra inteira para aliases curtos (ex.: "ST") não grudarem
      // em cabeçalhos como "ESTOQUE"/"DESCRICAO".
      const isBoundaryMatch = new RegExp(`(^|[^A-Z0-9])${escapeRegExp(normalizedAlias)}([^A-Z0-9]|$)`).test(header);
      if (isExact || isBoundaryMatch) {
        const score = isExact ? 100 : normalizedAlias.length;
        if (score > bestScore) {
          bestIndex = index;
          bestScore = score;
        }
      }
    });
  });

  return bestIndex;
}

function cell(cells: string[], index: number) {
  return index >= 0 ? String(cells[index] || "").trim() : "";
}

function looksLikeCatalogHeader(headers: string[]) {
  const descriptionIndex = findHeader(headers, ["DESCRICAO", "DESCRICAO PRODUTO", "PRODUTO", "ITEM"]);
  const priceIndex = findHeader(headers, ["PRECO NF", "PRECO", "VALOR NF", "CUSTO"]);
  const eanIndex = findHeader(headers, ["CODIGO EAN", "EAN", "COD BARRAS", "CODIGO DE BARRAS"]);
  const skuIndex = findHeader(headers, ["CODIGO", "COD PRODUTO", "SKU", "CODIGO PRODUTO"]);
  return descriptionIndex >= 0 && (priceIndex >= 0 || eanIndex >= 0 || skuIndex >= 0);
}

function findHeaderRowIndex(rows: string[][]) {
  const index = rows.findIndex((row) => looksLikeCatalogHeader(row.map(normalizeHeader)));
  if (index < 0) {
    throw new Error("Arquivo precisa ter cabecalho com Descricao/Produto e pelo menos EAN, Codigo ou Preco.");
  }
  return index;
}

function buildRowKey(supplierName: string, supplierSku: string, ean: string, description: string) {
  return normalizeText([supplierName, supplierSku || ean || description].join("|")).slice(0, 220);
}

function parseCatalogRows({
  rows,
  supplierName,
  sourceSystem,
  sourceFile,
  offerValidUntil,
  importedBy,
}: {
  rows: string[][];
  supplierName: string;
  sourceSystem: string;
  sourceFile: string;
  offerValidUntil: string | null;
  importedBy: string;
}) {
  const headerRowIndex = findHeaderRowIndex(rows);
  const headers = (rows[headerRowIndex] || []).map(normalizeHeader);
  const dataRows = rows.slice(headerRowIndex + 1);

  const eanIndex = findHeader(headers, ["CODIGO EAN", "EAN", "COD BARRAS", "CODIGO DE BARRAS", "GTIN"]);
  const skuIndex = findHeader(headers, ["CODIGO", "COD PRODUTO", "CODIGO PRODUTO", "SKU", "COD FORNECEDOR"]);
  const descriptionIndex = findHeader(headers, ["DESCRICAO", "DESCRICAO PRODUTO", "PRODUTO", "ITEM"]);
  const manufacturerIndex = findHeader(headers, ["LABORATORIO", "FABRICANTE", "MARCA", "INDUSTRIA"]);
  const categoryIndex = findHeader(headers, ["CATEGORIA", "CLASSIFICACAO", "LINHA"]);
  const deliveryIndex = findHeader(headers, ["ENTREGA", "PRAZO ENTREGA", "TIPO ENTREGA"]);
  const stockIndex = findHeader(headers, ["ESTOQUE", "SALDO", "DISPONIVEL", "QTD ESTOQUE"]);
  const priceNfIndex = findHeader(headers, ["PRECO NF", "VALOR NF", "PRECO LIQUIDO", "CUSTO NF"]);
  const listPriceIndex = findHeader(headers, ["PRECO TABELA", "PRECO", "VALOR", "PRECO BRUTO"]);
  const discountIndex = findHeader(headers, ["DESCONTO", "DESC", "% DESC"]);
  const stIndex = findHeader(headers, ["ST", "SUBST TRIBUTARIA", "SUBSTITUICAO"]);
  const minQtyIndex = findHeader(headers, ["QTDE", "QTD", "QUANTIDADE MINIMA", "MINIMO"]);
  const offerTypeIndex = findHeader(headers, ["OFERTA", "TIPO OFERTA", "CONDICAO", "CONDICAO COMERCIAL"]);
  const validUntilIndex = findHeader(headers, ["VALIDADE", "VALIDO ATE", "DATA FIM", "FIM OFERTA"]);

  if (descriptionIndex < 0) throw new Error("Arquivo precisa ter coluna de descricao/produto.");

  const importedAt = new Date().toISOString();
  const parsedRows: SupplierCatalogRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  dataRows.forEach((cells) => {
    const description = cell(cells, descriptionIndex).toUpperCase();
    const ean = normalizeCode(cell(cells, eanIndex));
    const supplierSku = normalizeCode(cell(cells, skuIndex));
    const rowKey = buildRowKey(supplierName, supplierSku, ean, description);

    if (!description || (!ean && !supplierSku)) {
      skipped += 1;
      return;
    }

    if (seen.has(rowKey)) {
      skipped += 1;
      return;
    }

    seen.add(rowKey);
    parsedRows.push({
      supplier_name: supplierName,
      source_system: sourceSystem,
      source_file: sourceFile,
      row_key: rowKey,
      ean,
      supplier_sku: supplierSku,
      description,
      manufacturer: cell(cells, manufacturerIndex).toUpperCase(),
      category: cell(cells, categoryIndex).toUpperCase(),
      delivery_type: cell(cells, deliveryIndex).toUpperCase(),
      available_stock: parseNumber(cell(cells, stockIndex)),
      price_nf: parseNumber(cell(cells, priceNfIndex)),
      list_price: parseNumber(cell(cells, listPriceIndex)),
      discount_percent: parseNumber(cell(cells, discountIndex)),
      st_value: parseNumber(cell(cells, stIndex)),
      minimum_quantity: parseNumber(cell(cells, minQtyIndex)),
      offer_type: cell(cells, offerTypeIndex).toUpperCase(),
      offer_valid_until: parseDateValue(cell(cells, validUntilIndex)) || offerValidUntil,
      is_active: true,
      imported_by: importedBy,
      imported_at: importedAt,
    });
  });

  return { rows: parsedRows, skipped };
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;
    if (!canManageSupplierCatalog(auth.profile.role, auth.profile.sector || "")) {
      return NextResponse.json({ error: "Acesso liberado apenas para Admin ou setor Compras." }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const supplierName = normalizeSupplier(String(formData.get("supplierName") || ""));
    const sourceSystem = normalizeText(String(formData.get("sourceSystem") || "MANUAL")).slice(0, 80);
    const offerValidUntil = parseDateValue(String(formData.get("offerValidUntil") || ""));

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Envie um arquivo CSV, TXT, XLS ou XLSX." }, { status: 400 });
    }

    if (!supplierName) {
      return NextResponse.json({ error: "Informe o fornecedor antes de importar." }, { status: 400 });
    }

    const rawRows = rowsFromFile(file.name, await file.arrayBuffer());
    const { rows, skipped } = parseCatalogRows({
      rows: rawRows,
      supplierName,
      sourceSystem,
      sourceFile: file.name,
      offerValidUntil,
      importedBy: auth.userId,
    });

    if (!rows.length) {
      return NextResponse.json({ error: "Nenhum item valido encontrado no arquivo." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { error: deactivateError } = await supabase
      .from("supplier_catalog_items")
      .update({ is_active: false })
      .eq("supplier_name", supplierName)
      .eq("source_system", sourceSystem);

    if (deactivateError) throw deactivateError;

    let imported = 0;
    const chunkSize = 800;
    for (let index = 0; index < rows.length; index += chunkSize) {
      const chunk = rows.slice(index, index + chunkSize);
      const { error } = await supabase
        .from("supplier_catalog_items")
        .upsert(chunk, { onConflict: "supplier_name,row_key" });

      if (error) throw error;
      imported += chunk.length;
    }

    return NextResponse.json({
      imported,
      skipped,
      supplierName,
      sourceSystem,
      sourceFile: file.name,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel importar catalogo do fornecedor.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
