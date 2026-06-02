import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireRole } from "@/lib/server-auth";

interface StockRow {
  snapshot_id: string;
  store_code: string;
  store_name: string;
  ean: string;
  erp_code: string | null;
  product_description: string;
  stock: number;
  confirmed_stock: number;
  monthly_avg_sales: number;
  stock_days: number;
  curve: string;
  confirmed_purchase: number;
  confirmed_transfer: number;
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

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCode(value: string) {
  return value.replace(/[^\dA-Za-z]/g, "").trim();
}

function normalizeStoreCode(value: string) {
  const cleaned = normalizeCode(value);
  return /^\d+$/.test(cleaned) ? cleaned.padStart(2, "0") : cleaned.toUpperCase();
}

function parseNumber(value: string) {
  const numericText = String(value || "")
    .replace(/[^\d,.-]/g, "")
    .trim();

  if (!numericText) return 0;

  const lastComma = numericText.lastIndexOf(",");
  const lastDot = numericText.lastIndexOf(".");
  const decimalSeparator = lastComma > lastDot ? "," : ".";
  const cleaned = numericText.includes(",") && numericText.includes(".")
    ? numericText
      .replace(decimalSeparator === "," ? /\./g : /,/g, "")
      .replace(decimalSeparator, ".")
    : numericText.replace(",", ".");

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function findHeader(headers: string[], matcher: (header: string) => boolean) {
  return headers.findIndex(matcher);
}

function requiredCell(cells: string[], index: number) {
  return index >= 0 ? String(cells[index] || "").trim() : "";
}

function parseStockCsv(csvText: string) {
  return parseStockRows(parseDelimitedRows(csvText));
}

function parseStockWorkbook(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false, raw: false });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error("A planilha nao possui abas.");
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false });

  return parseStockRows(rows.map((row) => row.map((cell) => String(cell || "").trim())));
}

function looksLikeStockHeader(headers: string[]) {
  const hasStore = headers.some((header) => header === "UN. NEG." || header === "UN NEG" || header.includes("UN. NEG"));
  const hasStoreName = headers.some((header) => header.includes("APELIDO"));
  const hasEan = headers.some((header) => header.includes("BARRA") || header.includes("EAN"));
  const hasProduct = headers.some((header) => header === "PRODUTO" || header.includes("DESCRICAO"));
  return hasStore && hasStoreName && hasEan && hasProduct;
}

function findHeaderRowIndex(rows: string[][]) {
  const headerIndex = rows.findIndex((row) => looksLikeStockHeader(row.map((header) => normalizeSearch(header))));
  if (headerIndex < 0) {
    throw new Error("Arquivo precisa ter Un. Neg., Apelido Un. Neg., Cod. de Barras e Produto.");
  }
  return headerIndex;
}

function parseStockRows(allRows: string[][]) {
  const headerRowIndex = findHeaderRowIndex(allRows);
  const headerRow = allRows[headerRowIndex] || [];
  const dataRows = allRows.slice(headerRowIndex + 1);
  const headers = headerRow.map((header) => normalizeSearch(header));

  const storeCodeIndex = findHeader(headers, (header) => header === "UN. NEG." || header === "UN NEG" || header.includes("UN. NEG"));
  const storeNameIndex = findHeader(headers, (header) => header.includes("APELIDO"));
  const eanIndex = findHeader(headers, (header) => header.includes("BARRA") || header.includes("EAN"));
  const productIndex = findHeader(headers, (header) => header === "PRODUTO" || header.includes("DESCRICAO"));
  const stockIndex = findHeader(headers, (header) => header === "ESTOQUE");
  const confirmedStockIndex = findHeader(headers, (header) => header.includes("ESTOQUE CONF"));
  const monthlyAvgIndex = findHeader(headers, (header) => header.includes("MEDIA VENDA MENSAL"));
  const dailyAvgIndex = findHeader(headers, (header) => header.includes("MEDIA VENDA DIARIA"));
  const stockDaysIndex = findHeader(headers, (header) => header.includes("ESTOQUE FINAL") && header.includes("DIAS"));
  const stockDaysFallbackIndex = findHeader(headers, (header) => header === "ESTOQUE (DIAS)" || header.includes("ESTOQUE DIAS"));
  const curveIndex = findHeader(headers, (header) => header.includes("CURVA"));
  const confirmedPurchaseIndex = findHeader(headers, (header) => header.includes("COMPRA CONF"));
  const confirmedTransferIndex = findHeader(headers, (header) => header.includes("TRANSF. CONF") || header.includes("TRANSF CONF"));

  if (storeCodeIndex < 0 || storeNameIndex < 0 || eanIndex < 0 || productIndex < 0) {
    throw new Error("Arquivo precisa ter Un. Neg., Apelido Un. Neg., Cod. de Barras e Produto.");
  }

  let skipped = 0;
  const rows = dataRows.flatMap((cells) => {
    const storeCode = normalizeStoreCode(requiredCell(cells, storeCodeIndex));
    const storeName = requiredCell(cells, storeNameIndex).toUpperCase();
    const ean = normalizeCode(requiredCell(cells, eanIndex));
    const productDescription = requiredCell(cells, productIndex).toUpperCase();

    if (!storeCode || !storeName || !ean || !productDescription) {
      skipped += 1;
      return [];
    }

    return [{
      store_code: storeCode,
      store_name: storeName,
      ean,
      product_description: productDescription,
      stock: parseNumber(requiredCell(cells, stockIndex)),
      confirmed_stock: parseNumber(requiredCell(cells, confirmedStockIndex)),
      monthly_avg_sales: monthlyAvgIndex >= 0
        ? parseNumber(requiredCell(cells, monthlyAvgIndex))
        : parseNumber(requiredCell(cells, dailyAvgIndex)) * 30,
      stock_days: stockDaysIndex >= 0
        ? parseNumber(requiredCell(cells, stockDaysIndex))
        : parseNumber(requiredCell(cells, stockDaysFallbackIndex)),
      curve: requiredCell(cells, curveIndex).toUpperCase(),
      confirmed_purchase: parseNumber(requiredCell(cells, confirmedPurchaseIndex)),
      confirmed_transfer: parseNumber(requiredCell(cells, confirmedTransferIndex)),
    }];
  });

  return { rows, skipped };
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ["admin"]);
    if (!auth.ok) return auth.response;

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Envie um arquivo CSV ou Excel." }, { status: 400 });
    }

    const normalizedName = file.name.toLowerCase();
    const isExcel = normalizedName.endsWith(".xlsx") || normalizedName.endsWith(".xls");
    const isCsv = normalizedName.endsWith(".csv");

    if (!isCsv && !isExcel) {
      return NextResponse.json({ error: "Importe um arquivo CSV, XLSX ou XLS." }, { status: 400 });
    }

    const { rows, skipped } = isExcel
      ? parseStockWorkbook(await file.arrayBuffer())
      : parseStockCsv(await file.text());
    if (!rows.length) {
      return NextResponse.json({ error: "Nenhuma linha valida de estoque encontrada." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: snapshot, error: snapshotError } = await supabase
      .from("reallocation_stock_snapshots")
      .insert([{ source_file: file.name, imported_by: auth.userId, notes: "Importacao de estoque e venda media" }])
      .select("id")
      .single();

    if (snapshotError) throw snapshotError;

    const eans = Array.from(new Set(rows.map((row) => row.ean)));
    const erpByEan = new Map<string, string>();
    const lookupChunkSize = 500;

    for (let index = 0; index < eans.length; index += lookupChunkSize) {
      const chunk = eans.slice(index, index + lookupChunkSize);
      const { data: products, error } = await supabase
        .from("reallocation_products")
        .select("ean,erp_code")
        .in("ean", chunk);

      if (error) throw error;
      (products || []).forEach((product) => {
        if (product.ean && product.erp_code && !erpByEan.has(product.ean)) {
          erpByEan.set(product.ean, product.erp_code);
        }
      });
    }

    const payload: StockRow[] = rows.map((row) => ({
      ...row,
      snapshot_id: snapshot.id,
      erp_code: erpByEan.get(row.ean) || null,
    }));

    const insertChunkSize = 1000;
    for (let index = 0; index < payload.length; index += insertChunkSize) {
      const { error } = await supabase
        .from("reallocation_stock_items")
        .insert(payload.slice(index, index + insertChunkSize));

      if (error) throw error;
    }

    const matchedProducts = payload.filter((row) => row.erp_code).length;

    return NextResponse.json({
      snapshotId: snapshot.id,
      imported: payload.length,
      matchedProducts,
      unmatchedProducts: payload.length - matchedProducts,
      skipped,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao importar estoque.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
