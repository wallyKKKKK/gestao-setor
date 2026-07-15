import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireAuthenticatedProfile } from "@/lib/server-auth";
import { normalizeReallocationSector } from "@/lib/reallocation-sector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REALLOCATION_API_VERSION = "reallocation-api-2026-06-19-v4";
const STOCK_SNAPSHOT_MAX_AGE_MINUTES = 30;
const STOCK_SNAPSHOT_MAX_AGE_MS = STOCK_SNAPSHOT_MAX_AGE_MINUTES * 60 * 1000;

function reallocationJson(payload: Record<string, unknown>, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store, max-age=0");

  return NextResponse.json(payload, {
    ...init,
    headers,
  });
}

type StockItem = {
  store_code?: string | null;
  store_name?: string | null;
  ean?: string | null;
  erp_code?: string | null;
  product_description?: string | null;
  stock?: number | string | null;
  confirmed_stock?: number | string | null;
  monthly_avg_sales?: number | string | null;
  stock_days?: number | string | null;
  curve?: string | null;
  confirmed_purchase?: number | string | null;
  confirmed_transfer?: number | string | null;
  last_sale_days?: number | string | null;
  last_purchase_days?: number | string | null;
  last_purchase_supplier?: string | null;
  need_type?: string | null;
  rupture_sales?: number | string | null;
  supplied_percent?: number | string | null;
  min_stock?: number | string | null;
  max_stock?: number | string | null;
  need_cost?: number | string | null;
};

type BranchLogistics = Record<string, {
  city?: string | null;
  group?: string | null;
  uf?: string | null;
}>;

type SuggestionOrigin = {
  item: StockItem;
  availableStock: number;
  remaining: number;
};

type SuggestionDestination = {
  item: StockItem;
  need: number;
};

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function storeCode(value: unknown) {
  return String(value || "").padStart(2, "0");
}

function formatSnapshotAge(minutes: number) {
  if (!Number.isFinite(minutes)) return "data desconhecida";
  if (minutes < 60) return `${minutes} minuto${minutes === 1 ? "" : "s"}`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const hourText = `${hours} hora${hours === 1 ? "" : "s"}`;
  if (remainingMinutes === 0) return hourText;

  return `${hourText} e ${remainingMinutes} minuto${remainingMinutes === 1 ? "" : "s"}`;
}

async function getSnapshotFreshnessError(snapshotId: string, sector: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("reallocation_stock_snapshots")
    .select("imported_at,sector")
    .eq("id", snapshotId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    return "Base de estoque nao encontrada. Importe um novo estoque antes de gerar o remanejamento.";
  }

  const snapshotSector = normalizeReallocationSector(data.sector);
  if (snapshotSector !== sector) {
    return `Esta base de estoque pertence ao setor ${snapshotSector}. Importe ou selecione uma base do setor ${sector} antes de gerar o remanejamento.`;
  }

  const importedAt = new Date(String(data.imported_at || "")).getTime();
  if (!Number.isFinite(importedAt)) {
    return "A base de estoque atual esta sem data de importacao valida. Importe um novo estoque antes de gerar o remanejamento.";
  }

  const ageMs = Date.now() - importedAt;
  if (ageMs <= STOCK_SNAPSHOT_MAX_AGE_MS) return "";

  const ageMinutes = Math.max(0, Math.floor(ageMs / 60000));
  return `A base de estoque foi importada ha ${formatSnapshotAge(ageMinutes)} e esta antiga. Importe um novo estoque antes de gerar o remanejamento.`;
}

function stockCurve(value: unknown) {
  return String(value || "").trim().toUpperCase().slice(0, 1);
}

const ROMAN_STORE_SUFFIXES = new Set(["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]);

function normalizeRouteText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toUpperCase();
}

function inferredStoreArea(item: StockItem) {
  const parts = normalizeRouteText(item.store_name).split(" ").filter(Boolean);

  while (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (!/^\d+$/.test(last) && !ROMAN_STORE_SUFFIXES.has(last)) break;
    parts.pop();
  }

  return parts.join(" ");
}

function availableStock(item: StockItem) {
  return Math.max(0, numberValue(item.stock), numberValue(item.confirmed_stock));
}

function realStock(item: StockItem) {
  return Math.max(0, numberValue(item.stock));
}

function originAvailableStock(item: StockItem) {
  const stock = realStock(item);
  const confirmedStock = item.confirmed_stock;

  if (confirmedStock === null || confirmedStock === undefined || String(confirmedStock).trim() === "") {
    return stock;
  }

  return Math.min(stock, Math.max(0, numberValue(confirmedStock)));
}

function normalizeMonthlyAvgSales(value: number) {
  if (value <= 0) return 0;
  return Math.round(value * 3) / 3;
}

function monthlyToDaily(value: unknown) {
  return normalizeMonthlyAvgSales(numberValue(value)) / 30;
}

function dailyToMonthly(value: number) {
  return normalizeMonthlyAvgSales(value * 30);
}

function ownDailySales(item: StockItem) {
  const monthlyDaily = monthlyToDaily(item.monthly_avg_sales);
  if (monthlyDaily > 0) return monthlyDaily;

  const stock = availableStock(item);
  const stockDays = numberValue(item.stock_days);
  if (stock > 0 && stockDays > 0) return stock / stockDays;

  return 0;
}

function effectiveStockDays(item: StockItem, dailySales: number) {
  const stockDays = numberValue(item.stock_days);
  if (dailySales > 0) return availableStock(item) / dailySales;
  return stockDays > 0 ? stockDays : 0;
}

function destinationNeedQuantity(stockDays: number, dailySales: number, targetDays: number) {
  const exactNeed = (targetDays - stockDays) * dailySales;
  if (exactNeed <= 0) return 0;
  return Math.max(0, Math.floor(exactNeed + 0.000001));
}

function routePriority(originItem: StockItem, destinationItem: StockItem, branchLogistics: BranchLogistics) {
  const originCode = storeCode(originItem.store_code);
  const destinationCode = storeCode(destinationItem.store_code);
  const origin = branchLogistics[originCode] || {};
  const destination = branchLogistics[destinationCode] || {};
  const originUf = String(origin.uf || "").trim().toUpperCase();
  const destinationUf = String(destination.uf || "").trim().toUpperCase();

  if (originUf && destinationUf && originUf !== destinationUf) return 999;

  const originGroup = String(origin.group || "").trim().toUpperCase();
  const destinationGroup = String(destination.group || "").trim().toUpperCase();
  const originCity = String(origin.city || "").trim().toUpperCase();
  const destinationCity = String(destination.city || "").trim().toUpperCase();

  if (originGroup && destinationGroup && originGroup === destinationGroup) return 0;
  if (originCity && destinationCity && originCity === destinationCity) return 2;

  const originArea = inferredStoreArea(originItem);
  const destinationArea = inferredStoreArea(destinationItem);
  if (originArea && destinationArea && originArea === destinationArea) return 2;

  if (originUf && destinationUf && originUf === destinationUf && originGroup && destinationGroup) return 6;

  const originNumber = Number(originCode);
  const destinationNumber = Number(destinationCode);
  if (!Number.isFinite(originNumber) || !Number.isFinite(destinationNumber)) return 10;

  const distance = Math.abs(originNumber - destinationNumber);
  if (distance <= 2) return 4;
  if (distance <= 5) return 6;
  if (distance <= 10) return 8;
  return 10;
}

function buildSuggestion(ean: string, origin: SuggestionOrigin, destination: SuggestionDestination, quantity: number, need: number, priority: number, index: number) {
  const originItem = origin.item;
  const destinationItem = destination.item;

  return {
    id: `${ean}:${originItem.store_code}:${destinationItem.store_code}:${index}`,
    originCode: storeCode(originItem.store_code),
    originName: originItem.store_name || "",
    destinationCode: storeCode(destinationItem.store_code),
    destinationName: destinationItem.store_name || "",
    erpCode: originItem.erp_code || destinationItem.erp_code || "",
    ean,
    description: destinationItem.product_description || "",
    quantity,
    maxQuantity: quantity,
    originStock: numberValue(originItem.stock),
    originAvailableStock: origin.availableStock,
    originConfirmedStock: numberValue(originItem.confirmed_stock),
    originMonthlyAvgSales: normalizeMonthlyAvgSales(numberValue(originItem.monthly_avg_sales)),
    originCurve: originItem.curve || "",
    originConfirmedPurchase: numberValue(originItem.confirmed_purchase),
    originConfirmedTransfer: numberValue(originItem.confirmed_transfer),
    destinationStock: numberValue(destinationItem.stock),
    destinationConfirmedStock: numberValue(destinationItem.confirmed_stock),
    destinationMonthlyAvgSales: normalizeMonthlyAvgSales(numberValue(destinationItem.monthly_avg_sales)),
    destinationCurve: destinationItem.curve || "",
    destinationConfirmedPurchase: numberValue(destinationItem.confirmed_purchase),
    destinationConfirmedTransfer: numberValue(destinationItem.confirmed_transfer),
    originDailySales: monthlyToDaily(originItem.monthly_avg_sales),
    destinationDailySales: monthlyToDaily(destinationItem.monthly_avg_sales),
    originStockDays: numberValue(originItem.stock_days),
    destinationStockDays: numberValue(destinationItem.stock_days),
    destinationNeed: need,
    routePriority: priority,
  };
}

function calculate(payload: {
  snapshotId?: string;
  stockItems?: StockItem[];
  filters?: {
    origins?: string[];
    destinations?: string[];
    products?: string[];
    classifications?: string[];
    classificationLines?: string[];
    classificationDepartments?: string[];
    classificationCategories?: string[];
    manufacturers?: string[];
    needTypes?: string[];
    lastPurchaseSuppliers?: string[];
  };
  rules?: {
    originMinimumDays?: number;
    destinationTargetDays?: number;
    maxRoutePriority?: number;
    originCurves?: string[];
    destinationCurves?: string[];
    lastSaleMaxDays?: number;
    lastPurchaseMaxDays?: number;
    minRuptureSales?: number;
    maxSuppliedPercent?: number;
  };
  branchLogistics?: BranchLogistics;
}) {
  const stockItems = Array.isArray(payload.stockItems) ? payload.stockItems : [];
  const filters = payload.filters || {};
  const rules = payload.rules || {};
  const branchLogistics = payload.branchLogistics || {};
  const selectedOrigins = new Set((filters.origins || []).map(storeCode));
  const selectedDestinations = new Set((filters.destinations || []).map(storeCode));
  const selectedProducts = new Set((filters.products || []).filter(Boolean).map(String));
  const selectedNeedTypes = new Set((filters.needTypes || []).map(normalizeRouteText).filter(Boolean));
  const selectedLastPurchaseSuppliers = new Set((filters.lastPurchaseSuppliers || []).map(normalizeRouteText).filter(Boolean));
  const originMinimumDays = numberValue(rules.originMinimumDays);
  const destinationTargetDays = numberValue(rules.destinationTargetDays);
  const maxRoutePriority = numberValue(rules.maxRoutePriority);
  const lastSaleMaxDays = numberValue(rules.lastSaleMaxDays);
  const lastPurchaseMaxDays = numberValue(rules.lastPurchaseMaxDays);
  const minRuptureSales = numberValue(rules.minRuptureSales);
  const maxSuppliedPercent = numberValue(rules.maxSuppliedPercent);
  const selectedOriginCurves = new Set((rules.originCurves || []).map(stockCurve).filter(Boolean));
  const selectedDestinationCurves = new Set((rules.destinationCurves || []).map(stockCurve).filter(Boolean));
  const grouped = new Map<string, StockItem[]>();
  let missingErpCode = 0;

  for (const item of stockItems) {
    const ean = String(item.ean || "");
    if (!ean) continue;
    if (!item.erp_code) missingErpCode += 1;
    if (selectedProducts.size > 0 && !selectedProducts.has(ean)) continue;
    if (lastSaleMaxDays > 0 && numberValue(item.last_sale_days) < lastSaleMaxDays) continue;
    if (lastPurchaseMaxDays > 0 && numberValue(item.last_purchase_days) < lastPurchaseMaxDays) continue;
    if (selectedNeedTypes.size > 0 && !selectedNeedTypes.has(normalizeRouteText(item.need_type))) continue;
    if (selectedLastPurchaseSuppliers.size > 0 && !selectedLastPurchaseSuppliers.has(normalizeRouteText(item.last_purchase_supplier))) continue;
    if (minRuptureSales > 0 && numberValue(item.rupture_sales) < minRuptureSales) continue;
    if (maxSuppliedPercent > 0 && numberValue(item.supplied_percent) > maxSuppliedPercent) continue;
    grouped.set(ean, [...(grouped.get(ean) || []), item]);
  }

  const suggestions = [];
  let eligibleOrigins = 0;
  let eligibleDestinations = 0;
  let blockedDifferentUf = 0;
  let blockedRoute = 0;

  for (const [ean, items] of grouped) {
    const origins: SuggestionOrigin[] = [];

    for (const item of items) {
      const code = storeCode(item.store_code);
      if (selectedOrigins.size > 0 && !selectedOrigins.has(code)) continue;
      if (selectedOriginCurves.size > 0 && !selectedOriginCurves.has(stockCurve(item.curve))) continue;

      const stock = originAvailableStock(item);
      if (stock <= 0) continue;

      const dailySales = ownDailySales(item);
      const stockDays = dailySales > 0 ? stock / dailySales : numberValue(item.stock_days);
      const protectedStock = dailySales > 0 ? dailySales * originMinimumDays : 0;
      const remaining = Math.max(0, Math.floor(stock - protectedStock));
      if (remaining > 0) {
        origins.push({
          item: {
            ...item,
            monthly_avg_sales: dailyToMonthly(dailySales),
            stock_days: stockDays,
          },
          availableStock: stock,
          remaining,
        });
      }
    }

    origins.sort((left, right) => (
      numberValue(right.item.stock_days) - numberValue(left.item.stock_days)
    ));
    eligibleOrigins += origins.length;

    const destinations: SuggestionDestination[] = [];
    for (const item of items) {
      const code = storeCode(item.store_code);
      if (selectedDestinations.size > 0 && !selectedDestinations.has(code)) continue;
      if (selectedDestinationCurves.size > 0 && !selectedDestinationCurves.has(stockCurve(item.curve))) continue;

      const stock = availableStock(item);
      const dailySales = ownDailySales(item);
      const stockDays = effectiveStockDays(item, dailySales);
      if (dailySales <= 0 || stockDays >= destinationTargetDays) continue;

      const need = destinationNeedQuantity(stockDays, dailySales, destinationTargetDays);
      if (need > 0) {
        destinations.push({
          item: {
            ...item,
            stock,
            monthly_avg_sales: dailyToMonthly(dailySales),
            stock_days: stockDays,
          },
          need,
        });
      }
    }

    destinations.sort((left, right) => numberValue(left.item.stock_days) - numberValue(right.item.stock_days));
    eligibleDestinations += destinations.length;

    for (const destination of destinations) {
      let remainingNeed = destination.need;
      const rankedOrigins: Array<{ origin: SuggestionOrigin; priority: number }> = [];

      for (const origin of origins) {
        if (origin.remaining <= 0) continue;
        if (storeCode(origin.item.store_code) === storeCode(destination.item.store_code)) continue;

        const priority = routePriority(origin.item, destination.item, branchLogistics);
        if (priority <= maxRoutePriority) {
          rankedOrigins.push({ origin, priority });
        } else if (priority === 999) {
          blockedDifferentUf += 1;
        } else {
          blockedRoute += 1;
        }
      }

      rankedOrigins.sort((left, right) => left.priority - right.priority || numberValue(right.origin.item.stock_days) - numberValue(left.origin.item.stock_days));

      for (const { origin, priority } of rankedOrigins) {
        if (remainingNeed <= 0 || origin.remaining <= 0) break;

        const quantity = Math.min(origin.remaining, remainingNeed);
        if (quantity <= 0) continue;

        origin.remaining -= quantity;
        remainingNeed -= quantity;
        suggestions.push(buildSuggestion(ean, origin, destination, quantity, destination.need, priority, suggestions.length));
      }
    }
  }

  return {
    engine: "typescript",
    suggestions,
    productGroups: grouped.size,
    stockRows: stockItems.length,
    eligibleOrigins,
    eligibleDestinations,
    missingErpCode,
    blockedDifferentUf,
    blockedRoute,
  };
}

async function fetchSnapshotStockItems(snapshotId: string) {
  const supabase = getSupabaseAdmin();
  const rows: StockItem[] = [];
  const chunkSize = 1000;
  let lastId = "";

  for (;;) {
    let query = supabase
      .from("reallocation_stock_items")
      .select("*")
      .eq("snapshot_id", snapshotId)
      .order("id", { ascending: true })
      .limit(chunkSize);

    if (lastId) {
      query = query.gt("id", lastId);
    }

    const { data, error } = await query;

    if (error) throw error;

    const chunk = (data || []) as Array<StockItem & { id?: string | null }>;
    rows.push(...chunk);
    if (chunk.length < chunkSize) break;

    const nextLastId = chunk[chunk.length - 1]?.id;
    if (!nextLastId || nextLastId === lastId) break;
    lastId = nextLastId;
  }

  return rows;
}

async function fetchServerBranchLogistics() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("pricing_branches")
    .select("code,city,logistics_group,uf");

  if (error) return {};

  return Object.fromEntries(((data || []) as Array<{
    code?: string | null;
    city?: string | null;
    logistics_group?: string | null;
    uf?: string | null;
  }>)
    .filter((branch) => branch.code)
    .map((branch) => [
      storeCode(branch.code),
      {
        city: branch.city || "",
        group: branch.logistics_group || "",
        uf: branch.uf || "",
      },
    ]));
}

function normalizeTerm(value: unknown) {
  return String(value || "").trim();
}

function normalizeFilterText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizedIncludes(value: unknown, term: unknown) {
  const normalizedValue = normalizeFilterText(value);
  const normalizedTerm = normalizeFilterText(term);
  if (!normalizedTerm) return true;
  return normalizedValue === normalizedTerm || normalizedValue.includes(normalizedTerm);
}

function splitClassificationPath(classificationPath: unknown) {
  return String(classificationPath || "")
    .replace(/\s*[>\\\/|]+\s*/g, " > ")
    .split(">")
    .map((part) => part.trim().toUpperCase().replace(/\s+/g, " "))
    .filter((part) => part && part !== "PRINCIPAL" && part !== "-" && part !== ".");
}

function parseClassificationHierarchy(classificationPath: unknown) {
  const parts = splitClassificationPath(classificationPath);

  if (parts.length >= 3) {
    return {
      line: parts[0] || "",
      department: parts[1] || "",
      category: parts.slice(2).join(" > "),
    };
  }

  if (parts.length === 2) {
    return {
      line: parts[0] || "",
      department: "",
      category: parts[1] || "",
    };
  }

  return {
    line: "",
    department: "",
    category: parts[0] || String(classificationPath || "").trim().toUpperCase(),
  };
}

function matchesAnyPart(value: string, filters: string[]) {
  return filters.length === 0 || filters.some((filter) => normalizedIncludes(value, filter));
}

function classificationMatchesFilters(classification: string, filters: {
  classifications: string[];
  classificationLines: string[];
  classificationDepartments: string[];
  classificationCategories: string[];
}) {
  if (
    filters.classifications.length === 0
    && filters.classificationLines.length === 0
    && filters.classificationDepartments.length === 0
    && filters.classificationCategories.length === 0
  ) {
    return true;
  }

  const hierarchy = parseClassificationHierarchy(classification);
  const matchesLegacy = filters.classifications.length === 0
    || filters.classifications.some((filter) => normalizedIncludes(classification, filter));

  return matchesLegacy
    && matchesAnyPart(hierarchy.line, filters.classificationLines)
    && matchesAnyPart(hierarchy.department, filters.classificationDepartments)
    && (
      filters.classificationCategories.length === 0
      || filters.classificationCategories.some((filter) => (
        normalizedIncludes(hierarchy.category, filter)
        || normalizedIncludes(classification, filter)
      ))
    );
}

function mergeProductFilters(filters: {
  products?: string[];
  classifications?: string[];
  classificationLines?: string[];
  classificationDepartments?: string[];
  classificationCategories?: string[];
  manufacturers?: string[];
}, attributeProducts: string[]) {
  const explicitProducts = new Set((filters.products || []).filter(Boolean).map(String));
  const hasAttributeFilters = Boolean(
    filters.classifications?.length
      || filters.classificationLines?.length
      || filters.classificationDepartments?.length
      || filters.classificationCategories?.length
      || filters.manufacturers?.length
  );

  if (!hasAttributeFilters) return Array.from(explicitProducts);

  const attributeSet = new Set(attributeProducts.filter(Boolean).map(String));
  if (explicitProducts.size === 0) return attributeSet.size > 0 ? Array.from(attributeSet) : ["__NO_PRODUCT_MATCH__"];

  const intersection = Array.from(explicitProducts).filter((ean) => attributeSet.has(ean));
  return intersection.length > 0 ? intersection : ["__NO_PRODUCT_MATCH__"];
}

async function fetchProductEansByAttributes(filters: {
  classifications?: string[];
  classificationLines?: string[];
  classificationDepartments?: string[];
  classificationCategories?: string[];
  manufacturers?: string[];
}) {
  const classifications = (filters.classifications || []).map(normalizeTerm).filter(Boolean);
  const classificationLines = (filters.classificationLines || []).map(normalizeTerm).filter(Boolean);
  const classificationDepartments = (filters.classificationDepartments || []).map(normalizeTerm).filter(Boolean);
  const classificationCategories = (filters.classificationCategories || []).map(normalizeTerm).filter(Boolean);
  const manufacturers = (filters.manufacturers || []).map(normalizeTerm).filter(Boolean);

  if (
    classifications.length === 0
    && classificationLines.length === 0
    && classificationDepartments.length === 0
    && classificationCategories.length === 0
    && manufacturers.length === 0
  ) return [];

  const supabase = getSupabaseAdmin();
  const rows: Array<{ id: string | null; ean: string | null; manufacturer: string | null; classification: string | null }> = [];
  const chunkSize = 1000;
  let lastId = "";

  for (;;) {
    let query = supabase
      .from("reallocation_products")
      .select("id,ean,manufacturer,classification")
      .not("ean", "is", null)
      .order("id", { ascending: true })
      .limit(chunkSize);

    if (lastId) {
      query = query.gt("id", lastId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const chunk = (data || []) as Array<{ id: string | null; ean: string | null; manufacturer: string | null; classification: string | null }>;
    rows.push(...chunk);
    if (chunk.length < chunkSize) break;

    const nextLastId = chunk[chunk.length - 1]?.id;
    if (!nextLastId || nextLastId === lastId) break;
    lastId = nextLastId;
  }

  return Array.from(new Set(rows
    .filter((row) => manufacturers.length === 0 || manufacturers.some((manufacturer) => normalizedIncludes(row.manufacturer, manufacturer)))
    .filter((row) => classificationMatchesFilters(String(row.classification || ""), {
      classifications,
      classificationLines,
      classificationDepartments,
      classificationCategories,
    }))
    .map((row) => row.ean)
    .filter((ean): ean is string => Boolean(ean))));
}

export async function GET() {
  return reallocationJson({
    apiVersion: REALLOCATION_API_VERSION,
    engine: "typescript",
    nodeEnv: process.env.NODE_ENV || "",
    vercel: Boolean(process.env.VERCEL),
  });
}

export async function POST(request: Request) {
  const auth = await requireAuthenticatedProfile(request);
  if (!auth.ok) return auth.response;

  try {
    const payload = await request.json();
    const snapshotId = payload?.snapshotId ? String(payload.snapshotId) : "";
    const activeSector = normalizeReallocationSector(auth.profile.sector);
    const snapshotFreshnessError = snapshotId ? await getSnapshotFreshnessError(snapshotId, activeSector) : "";

    if (snapshotFreshnessError) {
      return reallocationJson({
        error: snapshotFreshnessError,
        suggestions: [],
        staleStock: true,
        maxAgeMinutes: STOCK_SNAPSHOT_MAX_AGE_MINUTES,
      }, { status: 409 });
    }

    const stockItems = snapshotId
      ? await fetchSnapshotStockItems(snapshotId)
      : payload?.stockItems;
    const filters = payload?.filters || {};
    const attributeProducts = await fetchProductEansByAttributes(filters);
    const serverBranchLogistics = await fetchServerBranchLogistics();
    const calculationPayload = {
      ...payload,
      filters: {
        ...filters,
        products: mergeProductFilters(filters, attributeProducts),
      },
      branchLogistics: {
        ...(payload?.branchLogistics || {}),
        ...serverBranchLogistics,
      },
      stockItems,
    };
    const diagnostics = {
      apiVersion: REALLOCATION_API_VERSION,
      attributeProducts: attributeProducts.length,
      filteredProducts: Array.isArray(calculationPayload.filters.products) ? calculationPayload.filters.products.length : 0,
      branchLogistics: Object.keys(calculationPayload.branchLogistics).length,
    };

    return reallocationJson({
      ...calculate(calculationPayload),
      ...diagnostics,
      engineNote: "Motor TypeScript unico no ambiente hospedado.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao gerar sugestoes.";
    return reallocationJson({ error: message, suggestions: [] }, { status: 400 });
  }
}
