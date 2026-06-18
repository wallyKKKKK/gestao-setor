import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requirePerfumePurchasingOrSupreme } from "@/lib/server-auth";

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

function normalizeHeader(value: string) {
  return normalizeSearch(value)
    .replace(/[^A-Z0-9]+/g, " ")
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

function getAvailableStock(stock: number, confirmedStock: number) {
  return Math.max(0, stock, confirmedStock);
}

function calculateStockDays(stock: number, confirmedStock: number, monthlyAvgSales: number) {
  const dailySales = monthlyAvgSales / 30;
  if (dailySales <= 0) return 0;
  return roundNumber(getAvailableStock(stock, confirmedStock) / dailySales);
}

function normalizeMonthlyAvgSales(value: number) {
  if (value <= 0) return 0;
  return Number((Math.round(value * 3) / 3).toFixed(3));
}

function roundNumber(value: number, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function normalizeAlias(alias: string) {
  return normalizeHeader(alias);
}

function headerHasAlias(header: string, alias: string) {
  const normalizedAlias = normalizeAlias(alias);
  if (!normalizedAlias) return false;
  return header === normalizedAlias || header.includes(normalizedAlias);
}

function findHeader(
  headers: string[],
  aliases: string[],
  options: { reject?: string[]; prefer?: string[] } = {},
) {
  let bestIndex = -1;
  let bestScore = 0;

  headers.forEach((header, index) => {
    if (!header) return;
    if (options.reject?.some((alias) => headerHasAlias(header, alias))) return;

    const matchedAlias = aliases.find((alias) => headerHasAlias(header, alias));
    if (!matchedAlias) return;

    const normalizedAlias = normalizeAlias(matchedAlias);
    let score = header === normalizedAlias ? 100 : normalizedAlias.length;

    options.prefer?.forEach((alias) => {
      if (headerHasAlias(header, alias)) score += 20;
    });

    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });

  return bestIndex;
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
  const storeCodeIndex = findHeader(headers, ["UN NEG", "UN NEGOCIO", "UNIDADE NEGOCIO", "CODIGO LOJA", "COD LOJA", "LOJA"]);
  const storeNameIndex = findHeader(headers, ["APELIDO UN NEG", "APELIDO LOJA", "UNIDADE", "FILIAL", "LOJA NOME", "NOME LOJA"]);
  const eanIndex = findHeader(headers, ["COD DE BARRAS", "CODIGO DE BARRAS", "COD BARRAS", "EAN", "GTIN"]);
  const productIndex = findHeader(headers, ["PRODUTO", "DESCRICAO PRODUTO", "DESCRICAO"]);
  const stockIndex = findHeader(headers, ["ESTOQUE"], { reject: ["CONF", "DIAS", "MEDIA", "COMPRA", "TRANSF"] });
  const monthlyAvgIndex = findHeader(headers, ["MEDIA VENDA MENSAL", "VENDA MENSAL", "MEDIA MENSAL"]);
  const dailyAvgIndex = findHeader(headers, ["MEDIA VENDA DIARIA", "VENDA DIARIA", "MEDIA DIARIA"]);

  return storeCodeIndex >= 0
    && storeNameIndex >= 0
    && eanIndex >= 0
    && productIndex >= 0
    && stockIndex >= 0
    && (monthlyAvgIndex >= 0 || dailyAvgIndex >= 0);
}

function findHeaderRowIndex(rows: string[][]) {
  const headerIndex = rows.findIndex((row) => looksLikeStockHeader(row.map((header) => normalizeHeader(header))));
  if (headerIndex < 0) {
    throw new Error("Arquivo precisa ter Un. Neg., Apelido Un. Neg., Cod. de Barras e Produto.");
  }
  return headerIndex;
}

function parseStockRows(allRows: string[][]) {
  const headerRowIndex = findHeaderRowIndex(allRows);
  const headerRow = allRows[headerRowIndex] || [];
  const dataRows = allRows.slice(headerRowIndex + 1);
  const headers = headerRow.map((header) => normalizeHeader(header));

  const storeCodeIndex = findHeader(headers, ["UN NEG", "UN NEGOCIO", "UNIDADE NEGOCIO", "CODIGO LOJA", "COD LOJA", "LOJA"], {
    reject: ["APELIDO", "NOME"],
    prefer: ["UN NEG"],
  });
  const storeNameIndex = findHeader(headers, ["APELIDO UN NEG", "APELIDO LOJA", "UNIDADE", "FILIAL", "LOJA NOME", "NOME LOJA"], {
    reject: ["CODIGO", "COD"],
    prefer: ["APELIDO"],
  });
  const eanIndex = findHeader(headers, ["COD DE BARRAS", "CODIGO DE BARRAS", "COD BARRAS", "EAN", "GTIN"]);
  const productIndex = findHeader(headers, ["PRODUTO", "DESCRICAO PRODUTO", "DESCRICAO"], {
    reject: ["PRINCIPIO ATIVO", "FABRICANTE", "CLASSIFICACAO"],
    prefer: ["PRODUTO"],
  });
  const stockIndex = findHeader(headers, ["ESTOQUE"], {
    reject: ["CONF", "DIAS", "MEDIA", "COMPRA", "TRANSF", "DESTINO", "DEST"],
  });
  const confirmedStockIndex = findHeader(headers, ["ESTOQUE CONFIRMADO", "ESTOQUE CONF", "EST CONF"]);
  const monthlyAvgIndex = findHeader(headers, ["MEDIA VENDA MENSAL", "VENDA MEDIA MENSAL", "VENDA MENSAL", "MEDIA MENSAL"]);
  const dailyAvgIndex = findHeader(headers, ["MEDIA VENDA DIARIA", "VENDA MEDIA DIARIA", "VENDA DIARIA", "MEDIA DIARIA"]);
  const curveIndex = findHeader(headers, ["CURVA QTD", "CURVA ABC QTD", "CURVA ABC", "CURVA"], {
    reject: ["VALOR"],
  });
  const confirmedPurchaseIndex = findHeader(headers, ["COMPRA CONFIRMADA", "COMPRA CONF", "COMPRA"]);
  const confirmedTransferIndex = findHeader(headers, ["TRANSF CONFIRMADA", "TRANSFERENCIA CONFIRMADA", "TRANSF CONF", "TRANSFERENCIA CONF"]);

  if (storeCodeIndex < 0 || storeNameIndex < 0 || eanIndex < 0 || productIndex < 0 || stockIndex < 0 || (monthlyAvgIndex < 0 && dailyAvgIndex < 0)) {
    throw new Error("Arquivo precisa ter loja, apelido da loja, EAN, produto, estoque e media de venda mensal ou diaria.");
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

    const stock = parseNumber(requiredCell(cells, stockIndex));
    const confirmedStock = parseNumber(requiredCell(cells, confirmedStockIndex));
    const dailyAvgSales = parseNumber(requiredCell(cells, dailyAvgIndex));
    const monthlyAvgSalesFromColumn = parseNumber(requiredCell(cells, monthlyAvgIndex));
    const monthlyAvgSales = normalizeMonthlyAvgSales(
      dailyAvgSales > 0 ? dailyAvgSales * 30 : monthlyAvgSalesFromColumn,
    );

    return [{
      store_code: storeCode,
      store_name: storeName,
      ean,
      product_description: productDescription,
      stock,
      confirmed_stock: confirmedStock,
      monthly_avg_sales: monthlyAvgSales,
      stock_days: calculateStockDays(stock, confirmedStock, monthlyAvgSales),
      curve: requiredCell(cells, curveIndex).toUpperCase(),
      confirmed_purchase: parseNumber(requiredCell(cells, confirmedPurchaseIndex)),
      confirmed_transfer: parseNumber(requiredCell(cells, confirmedTransferIndex)),
    }];
  });

  return { rows, skipped };
}

export async function POST(request: Request) {
  let importStage = "processar arquivo";
  let createdSnapshotId: string | null = null;
  let supabase: ReturnType<typeof getSupabaseAdmin> | null = null;

  try {
    importStage = "validar permissao";
    const auth = await requirePerfumePurchasingOrSupreme(request);
    if (!auth.ok) return auth.response;

    importStage = "ler formulario";
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

    importStage = "ler arquivo de estoque";
    const { rows, skipped } = isExcel
      ? parseStockWorkbook(await file.arrayBuffer())
      : parseStockCsv(await file.text());
    if (!rows.length) {
      return NextResponse.json({ error: "Nenhuma linha valida de estoque encontrada." }, { status: 400 });
    }

    importStage = "criar controle de importacao";
    supabase = getSupabaseAdmin();
    const { data: snapshot, error: snapshotError } = await supabase
      .from("reallocation_stock_snapshots")
      .insert([{ source_file: file.name.normalize("NFC"), imported_by: auth.userId, notes: "Importacao de estoque e venda media" }])
      .select("id")
      .single();

    if (snapshotError) throw snapshotError;
    createdSnapshotId = snapshot.id;

    importStage = "vincular EAN ao codigo ERP";
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

    importStage = "salvar linhas de estoque";
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
    if (createdSnapshotId && supabase) {
      await supabase
        .from("reallocation_stock_snapshots")
        .delete()
        .eq("id", createdSnapshotId);
    }

    const baseMessage = error instanceof Error ? error.message : "Erro ao importar estoque.";
    const message = /^(Arquivo|Nenhuma|Importe|Envie)/i.test(baseMessage)
      ? baseMessage
      : `Erro ao ${importStage}: ${baseMessage}`;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
