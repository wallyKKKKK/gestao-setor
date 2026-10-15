import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { requireAuthenticatedProfile } from "@/lib/server-auth";
import { normalizeReallocationSector } from "@/lib/reallocation-sector";
import { createErpInventorySnapshot, splitErpClassificationPath } from "@/lib/erp-inventory";
import type { ReallocationImportIssue } from "@/lib/reallocation-import-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  last_sale_days: number;
  last_purchase_days: number;
  last_purchase_supplier: string | null;
  need_type: string | null;
  rupture_sales: number;
  supplied_percent: number;
  min_stock: number;
  max_stock: number;
  need_cost: number;
}

interface StockProductAttribute {
  ean: string;
  description: string;
  manufacturer: string;
  classification: string;
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
      rows.push(row);
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

function normalizeProductSearch(...values: string[]) {
  return values
    .map((value) => normalizeSearch(value))
    .filter(Boolean)
    .join(" ");
}

function normalizeAttribute(value: string) {
  return normalizeSearch(value);
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
  return Number.isFinite(value) && value > 0 ? value : 0;
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
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false, blankrows: true });

  return parseStockRows(rows.map((row) => row.map((cell) => String(cell || "").trim())));
}

function looksLikeStockHeader(headers: string[]) {
  const storeCodeIndex = findHeader(headers, ["UN NEG", "UN NEGOCIO", "UNIDADE NEGOCIO", "CODIGO LOJA", "COD LOJA", "LOJA"]);
  const storeNameIndex = findHeader(headers, ["APELIDO UN NEG", "APELIDO LOJA", "UNIDADE", "FILIAL", "LOJA NOME", "NOME LOJA"]);
  const eanIndex = findHeader(headers, ["COD DE BARRAS", "CODIGO DE BARRAS", "COD BARRAS", "EAN", "GTIN"]);
  const productIndex = findHeader(headers, ["PRODUTO", "DESCRICAO PRODUTO", "DESCRICAO"]);
  const stockIndex = findHeader(headers, ["ESTOQUE"], { reject: ["CONF", "DIAS", "MEDIA", "COMPRA", "TRANSF"] });
  const monthlyAvgIndex = findHeader(headers, ["MEDIA VENDA MENSAL", "VENDA MEDIA MENSAL", "VENDA MENSAL", "MEDIA MENSAL"]);

  return storeCodeIndex >= 0
    && storeNameIndex >= 0
    && eanIndex >= 0
    && productIndex >= 0
    && stockIndex >= 0
    && monthlyAvgIndex >= 0;
}

function findHeaderRowIndex(rows: string[][]) {
  const headerIndex = rows.findIndex((row) => looksLikeStockHeader(row.map((header) => normalizeHeader(header))));
  if (headerIndex < 0) {
    throw new Error("Arquivo precisa ter Un. Neg., Apelido Un. Neg., Cod. de Barras, Produto, Estoque e Media de venda mensal.");
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
  const curveIndex = findHeader(headers, ["CURVA QTD", "CURVA ABC QTD", "CURVA ABC", "CURVA"], {
    reject: ["VALOR"],
  });
  const manufacturerIndex = findHeader(headers, ["FABRICANTE", "MARCA"]);
  const classificationIndex = findHeader(headers, ["CLASSIFICACAO PRINCIPAL", "CLASSIFICACAO", "CATEGORIA", "GRUPO"], {
    reject: ["CURVA"],
    prefer: ["CLASSIFICACAO PRINCIPAL"],
  });
  const confirmedPurchaseIndex = findHeader(headers, ["COMPRA CONFIRMADA", "COMPRA CONF", "COMPRA"]);
  const confirmedTransferIndex = findHeader(headers, ["TRANSF CONFIRMADA", "TRANSFERENCIA CONFIRMADA", "TRANSF CONF", "TRANSFERENCIA CONF"]);
  const lastSaleDaysIndex = findHeader(headers, ["ULT VENDA DIAS", "ULTIMA VENDA DIAS", "ULT VENDA", "ULTIMA VENDA"]);
  const lastPurchaseDaysIndex = findHeader(headers, ["ULT COMPRA DIAS", "ULTIMA COMPRA DIAS", "ULT COMPRA", "ULTIMA COMPRA"]);
  const lastPurchaseSupplierIndex = findHeader(headers, ["FORNECEDOR ULT COMPRA", "FORNECEDOR ULTIMA COMPRA", "ULTIMO FORNECEDOR"]);
  const needTypeIndex = findHeader(headers, ["TIPO NECESSIDADE", "NECESSIDADE TIPO"]);
  const ruptureSalesIndex = findHeader(headers, ["RUPTURA VENDA"]);
  const suppliedPercentIndex = findHeader(headers, ["% SUPRIDA QTD", "PERCENTUAL SUPRIDA", "SUPRIDA QTD"]);
  const minStockIndex = findHeader(headers, ["EST MIN", "ESTOQUE MINIMO"], { reject: ["ORIGEM", "DIAS", "VIG"] });
  const maxStockIndex = findHeader(headers, ["EST MAX", "ESTOQUE MAXIMO"], { reject: ["ORIGEM", "DIAS", "VIG"] });
  const needCostIndex = findHeader(headers, ["CUSTO X NECESSIDADE"]);

  if (storeCodeIndex < 0 || storeNameIndex < 0 || eanIndex < 0 || productIndex < 0 || stockIndex < 0 || monthlyAvgIndex < 0) {
    throw new Error("Arquivo precisa ter loja, apelido da loja, EAN, produto, estoque e media de venda mensal.");
  }

  let skipped = 0;
  const skippedRows: ReallocationImportIssue[] = [];
  const validRowDetails: ReallocationImportIssue[] = [];
  const attributesByEan = new Map<string, StockProductAttribute>();
  const rows = dataRows.flatMap((cells, index) => {
    if (!cells.some((cell) => cell.trim())) return [];
    const storeCode = normalizeStoreCode(requiredCell(cells, storeCodeIndex));
    const storeName = requiredCell(cells, storeNameIndex).toUpperCase();
    const ean = normalizeCode(requiredCell(cells, eanIndex));
    const productDescription = requiredCell(cells, productIndex).toUpperCase();
    const detail = { line: headerRowIndex + index + 2, storeCode, storeName, ean, product: productDescription, reason: '' };

    if (!storeCode || !storeName || !ean || !productDescription) {
      skipped += 1;
      const missing = [!storeCode && 'codigo da loja', !storeName && 'nome da loja', !ean && 'EAN', !productDescription && 'descricao do produto'].filter(Boolean);
      skippedRows.push({ ...detail, reason: `Campos obrigatorios ausentes: ${missing.join(', ')}` });
      return [];
    }
    validRowDetails.push(detail);

    const stock = parseNumber(requiredCell(cells, stockIndex));
    const confirmedStock = confirmedStockIndex >= 0
      ? parseNumber(requiredCell(cells, confirmedStockIndex))
      : stock;
    const monthlyAvgSalesFromColumn = parseNumber(requiredCell(cells, monthlyAvgIndex));
    const monthlyAvgSales = normalizeMonthlyAvgSales(monthlyAvgSalesFromColumn);
    const manufacturer = normalizeAttribute(requiredCell(cells, manufacturerIndex));
    const classification = normalizeAttribute(requiredCell(cells, classificationIndex));
    const currentAttribute = attributesByEan.get(ean);

    if (manufacturer || classification) {
      attributesByEan.set(ean, {
        ean,
        description: currentAttribute?.description || productDescription,
        manufacturer: manufacturer || currentAttribute?.manufacturer || "",
        classification: classification || currentAttribute?.classification || "",
      });
    }

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
      last_sale_days: parseNumber(requiredCell(cells, lastSaleDaysIndex)),
      last_purchase_days: parseNumber(requiredCell(cells, lastPurchaseDaysIndex)),
      last_purchase_supplier: requiredCell(cells, lastPurchaseSupplierIndex).toUpperCase() || null,
      need_type: requiredCell(cells, needTypeIndex).toUpperCase() || null,
      rupture_sales: parseNumber(requiredCell(cells, ruptureSalesIndex)),
      supplied_percent: parseNumber(requiredCell(cells, suppliedPercentIndex)),
      min_stock: parseNumber(requiredCell(cells, minStockIndex)),
      max_stock: parseNumber(requiredCell(cells, maxStockIndex)),
      need_cost: parseNumber(requiredCell(cells, needCostIndex)),
    }];
  });

  return { rows, skipped, skippedRows, validRowDetails, totalRows: rows.length + skipped, attributes: Array.from(attributesByEan.values()) };
}

function stripMovementColumns(rows: StockRow[]) {
  return rows.map((row) => {
    const fallbackRow: Partial<StockRow> = { ...row };
    delete fallbackRow.last_sale_days;
    delete fallbackRow.last_purchase_days;
    delete fallbackRow.last_purchase_supplier;
    delete fallbackRow.need_type;
    delete fallbackRow.rupture_sales;
    delete fallbackRow.supplied_percent;
    delete fallbackRow.min_stock;
    delete fallbackRow.max_stock;
    delete fallbackRow.need_cost;

    return fallbackRow;
  });
}

export async function POST(request: Request) {
  let importStage = "processar arquivo";
  let createdSnapshotId: string | null = null;
  let supabase: ReturnType<typeof getSupabaseAdmin> | null = null;

  try {
    importStage = "validar permissao";
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;

    const retrySeconds = checkRateLimit(`reallocation-stock-import:${auth.userId}`, 12, 10 * 60_000);
    if (retrySeconds !== null) return rateLimitResponse(retrySeconds);


    importStage = "ler formulario";
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (formError) {
      const detail = formError instanceof Error ? formError.message : "";
      const sizeHint = /size|body|payload|too large|large|limit|form/i.test(detail)
        ? " O arquivo pode ter passado do limite de upload do servidor. Use um arquivo completo menor, pois cada importacao substitui toda a base do setor."
        : "";
      return NextResponse.json(
        { error: `Nao consegui receber o arquivo de estoque.${sizeHint}` },
        { status: 413 },
      );
    }
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
    const { rows, skipped, skippedRows, validRowDetails, totalRows, attributes } = isExcel
      ? parseStockWorkbook(await file.arrayBuffer())
      : parseStockCsv(await file.text());
    if (!rows.length) {
      return NextResponse.json({
        error: "Nenhuma linha valida de estoque encontrada. A base anterior foi preservada.",
        sourceFile: file.name, sector: normalizeReallocationSector(auth.profile.sector),
        imported: 0, replacedRows: 0, matchedProducts: 0, unmatchedProducts: 0,
        skipped, skippedRows, totalRows, uniqueProducts: 0, stores: [], unmatchedItems: [],
        movementColumnsAvailable: true, erpInventoryWarning: null,
      }, { status: 400 });
    }

    importStage = "preparar nova base de estoque";
    supabase = getSupabaseAdmin();
    const activeSector = normalizeReallocationSector(auth.profile.sector);

    // Keep partial uploads invisible until all rows have been saved and validated.
    const { data: snapshot, error: snapshotError } = await supabase
        .from("reallocation_stock_snapshots")
        .insert([{ source_file: file.name.normalize("NFC"), sector: activeSector, imported_by: auth.userId, is_ready: false, notes: "Importacao em andamento" }])
        .select("id,source_file,notes")
        .single();

    if (snapshotError) throw snapshotError;
    createdSnapshotId = snapshot.id;

    if (!snapshot?.id) {
      throw new Error("Nao foi possivel preparar o snapshot de estoque.");
    }

    importStage = "vincular EAN ao codigo ERP";
    const eans = Array.from(new Set(rows.map((row) => row.ean)));
    const erpByEan = new Map<string, string>();
    const productsByEan = new Map<string, Array<{
      ean: string;
      erp_code: string;
      description: string | null;
      manufacturer: string | null;
      classification: string | null;
      source_file: string | null;
    }>>();
    const lookupChunkSize = 500;

    for (let index = 0; index < eans.length; index += lookupChunkSize) {
      const chunk = eans.slice(index, index + lookupChunkSize);
      const { data: products, error } = await supabase
        .from("reallocation_products")
        .select("ean,erp_code,description,manufacturer,classification,source_file")
        .in("ean", chunk);

      if (error) throw error;
      (products || []).forEach((product) => {
        if (product.ean && product.erp_code && !erpByEan.has(product.ean)) {
          erpByEan.set(product.ean, product.erp_code);
        }
        if (product.ean && product.erp_code) {
          productsByEan.set(product.ean, [...(productsByEan.get(product.ean) || []), product]);
        }
      });
    }

    importStage = "atualizar atributos dos produtos";
    const attributesByEan = new Map(attributes.map((attribute) => [attribute.ean, attribute]));
    const productAttributePayload = Array.from(attributesByEan.values()).flatMap((attribute) => {
      const products = productsByEan.get(attribute.ean) || [];

      return products.map((product) => {
        const manufacturer = attribute.manufacturer || product.manufacturer || "";
        const classification = attribute.classification || product.classification || "";
        const description = product.description || attribute.description || "";

        return {
          erp_code: product.erp_code,
          ean: product.ean,
          description,
          manufacturer,
          classification,
          search_text: normalizeProductSearch(product.erp_code, product.ean, description, manufacturer, classification),
          source_file: product.source_file || file.name.normalize("NFC"),
        };
      });
    });
    let enrichedProducts = 0;

    for (let index = 0; index < productAttributePayload.length; index += lookupChunkSize) {
      const chunk = productAttributePayload.slice(index, index + lookupChunkSize);
      const { error } = await supabase
        .from("reallocation_products")
        .upsert(chunk, { onConflict: "erp_code,ean" });

      if (error) throw error;
      enrichedProducts += chunk.length;
    }

    const productMetaByEan = new Map<string, {
      description: string;
      manufacturer: string;
      classification: string;
    }>();

    productsByEan.forEach((products, ean) => {
      const product = products.find((item) => item.manufacturer || item.classification || item.description) || products[0];
      if (!product) return;

      productMetaByEan.set(ean, {
        description: product.description || "",
        manufacturer: product.manufacturer || "",
        classification: product.classification || "",
      });
    });

    attributesByEan.forEach((attribute, ean) => {
      const current = productMetaByEan.get(ean);
      productMetaByEan.set(ean, {
        description: current?.description || attribute.description || "",
        manufacturer: attribute.manufacturer || current?.manufacturer || "",
        classification: attribute.classification || current?.classification || "",
      });
    });

    const payload: StockRow[] = rows.map((row) => ({
      ...row,
      snapshot_id: snapshot.id,
      erp_code: erpByEan.get(row.ean) || null,
    }));

    importStage = "salvar linhas de estoque";
    const insertChunkSize = 1000;
    let movementColumnsAvailable = true;
    for (let index = 0; index < payload.length; index += insertChunkSize) {
      const chunk = payload.slice(index, index + insertChunkSize);
      let { error } = await supabase
        .from("reallocation_stock_items")
        .insert(chunk);

      if (error && /last_sale_days|last_purchase_days|last_purchase_supplier|need_type|rupture_sales|supplied_percent|min_stock|max_stock|need_cost|schema cache/i.test(error.message || "")) {
        movementColumnsAvailable = false;
        const fallback = await supabase
          .from("reallocation_stock_items")
          .insert(stripMovementColumns(chunk));
        error = fallback.error;
      }

      if (error) throw error;
    }

    const matchedProducts = payload.filter((row) => row.erp_code).length;
    const sourceFile = file.name.normalize("NFC");
    importStage = "substituir base ativa do setor";
    const { data: replacedRows, error: publishError } = await supabase.rpc("publish_reallocation_stock_snapshot", {
      p_snapshot_id: snapshot.id,
      p_sector: activeSector,
      p_expected_rows: payload.length,
    });
    if (publishError) throw publishError;
    createdSnapshotId = null;

    importStage = "espelhar estoque no nucleo ERP";
    let erpInventorySnapshotId: string | null = null;
    let erpInventoryCurrentUpdated = 0;
    let erpInventoryWarning: string | null = null;

    try {
      const erpResult = await createErpInventorySnapshot({
        sourceModule: "reallocation",
        sourceFile,
        sector: activeSector,
        importedBy: auth.userId,
        notes: `Espelho ERP gerado a partir da importacao de remanejamento ${snapshot.id}`,
        items: payload.map((row) => {
          const meta = productMetaByEan.get(row.ean);
          const classificationPath = meta?.classification || "";
          const classification = splitErpClassificationPath(classificationPath);

          return {
            branchCode: row.store_code,
            branchName: row.store_name,
            ean: row.ean,
            erpCode: row.erp_code,
            productDescription: meta?.description || row.product_description,
            manufacturer: meta?.manufacturer || "",
            classificationPath,
            line: classification.line,
            department: classification.department,
            category: classification.category,
            stockQuantity: row.stock,
            confirmedQuantity: row.confirmed_stock,
            monthlyAvgSales: row.monthly_avg_sales,
            dailyAvgSales: row.monthly_avg_sales > 0 ? row.monthly_avg_sales / 30 : 0,
            stockDays: row.stock_days,
            curve: row.curve,
            lastSaleDays: row.last_sale_days,
            lastPurchaseDays: row.last_purchase_days,
            lastPurchaseSupplier: row.last_purchase_supplier,
            minStock: row.min_stock,
            maxStock: row.max_stock,
            rawPayload: {
              confirmed_purchase: row.confirmed_purchase,
              confirmed_transfer: row.confirmed_transfer,
              need_type: row.need_type,
              rupture_sales: row.rupture_sales,
              supplied_percent: row.supplied_percent,
              need_cost: row.need_cost,
            },
          };
        }),
      });

      erpInventorySnapshotId = erpResult.snapshotId;
      erpInventoryCurrentUpdated = erpResult.currentUpdated;
    } catch (erpError) {
      erpInventoryWarning = erpError instanceof Error ? erpError.message : "Nao foi possivel espelhar o estoque no nucleo ERP.";
      console.error("Erro ao espelhar estoque no nucleo ERP", erpError);
    }

    return NextResponse.json({
      sourceFile,
      totalRows,
      uniqueProducts: eans.length,
      stores: Array.from(new Map(rows.map((row) => [row.store_code, { code: row.store_code, name: row.store_name }])).values()),
      skippedRows,
      unmatchedItems: validRowDetails.filter((row) => !erpByEan.has(row.ean)).map((row) => ({ ...row, reason: 'EAN sem codigo ERP vinculado na base de produtos' })),
      snapshotId: snapshot.id,
      sector: activeSector,
      accumulated: false,
      imported: payload.length,
      replacedRows,
      matchedProducts,
      unmatchedProducts: payload.length - matchedProducts,
      enrichedProducts,
      skipped,
      movementColumnsAvailable,
      erpInventorySnapshotId,
      erpInventoryCurrentUpdated,
      erpInventoryWarning,
    });
  } catch (error) {
    if (createdSnapshotId && supabase) {
      await supabase
        .from("reallocation_stock_snapshots")
        .delete()
        .eq("id", createdSnapshotId)
        .eq("is_ready", false);
    }

    const baseMessage = error instanceof Error ? error.message : "Erro ao importar estoque.";
    const lowerMessage = baseMessage.toLowerCase();
    const friendlyMessage = /sector|schema cache/.test(lowerMessage)
      ? "A separacao de estoque por setor ainda nao foi aplicada no banco. Rode o SQL atualizado de reallocation-stock.sql no Supabase e tente importar novamente."
      : /statement timeout|timeout|timed out/.test(lowerMessage)
        ? "A importacao demorou mais que o banco permitiu. A base anterior foi preservada; tente novamente com o arquivo completo."
        : baseMessage;
    const message = /^(Arquivo|Nenhuma|Importe|Envie|A separacao|A importacao)/i.test(friendlyMessage)
      ? friendlyMessage
      : `Erro ao ${importStage}: ${friendlyMessage}`;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
