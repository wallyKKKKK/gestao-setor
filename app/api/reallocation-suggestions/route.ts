import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireAuthenticatedProfile } from "@/lib/server-auth";

export const runtime = "nodejs";

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
};

type BranchLogistics = Record<string, {
  city?: string | null;
  group?: string | null;
  uf?: string | null;
}>;

type SuggestionOrigin = {
  item: StockItem;
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
    originConfirmedStock: numberValue(originItem.confirmed_stock),
    originMonthlyAvgSales: numberValue(originItem.monthly_avg_sales),
    originCurve: originItem.curve || "",
    originConfirmedPurchase: numberValue(originItem.confirmed_purchase),
    originConfirmedTransfer: numberValue(originItem.confirmed_transfer),
    destinationStock: numberValue(destinationItem.stock),
    destinationConfirmedStock: numberValue(destinationItem.confirmed_stock),
    destinationMonthlyAvgSales: numberValue(destinationItem.monthly_avg_sales),
    destinationCurve: destinationItem.curve || "",
    destinationConfirmedPurchase: numberValue(destinationItem.confirmed_purchase),
    destinationConfirmedTransfer: numberValue(destinationItem.confirmed_transfer),
    originDailySales: numberValue(originItem.monthly_avg_sales) / 30,
    destinationDailySales: numberValue(destinationItem.monthly_avg_sales) / 30,
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
    manufacturers?: string[];
  };
  rules?: {
    originMinimumDays?: number;
    needDaysThreshold?: number;
    destinationTargetDays?: number;
    maxRoutePriority?: number;
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
  const originMinimumDays = numberValue(rules.originMinimumDays);
  const needDaysThreshold = numberValue(rules.needDaysThreshold);
  const destinationTargetDays = numberValue(rules.destinationTargetDays);
  const maxRoutePriority = numberValue(rules.maxRoutePriority);
  const grouped = new Map<string, StockItem[]>();
  let missingErpCode = 0;

  for (const item of stockItems) {
    const ean = String(item.ean || "");
    if (!ean) continue;
    if (!item.erp_code) missingErpCode += 1;
    if (selectedProducts.size > 0 && !selectedProducts.has(ean)) continue;
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

      const stock = numberValue(item.stock);
      if (stock <= 0) continue;

      const dailySales = numberValue(item.monthly_avg_sales) / 30;
      const protectedStock = dailySales > 0 ? dailySales * originMinimumDays : 0;
      const remaining = Math.max(0, Math.floor(stock - protectedStock));
      if (remaining > 0) origins.push({ item, remaining });
    }

    origins.sort((left, right) => numberValue(right.item.stock_days) - numberValue(left.item.stock_days));
    eligibleOrigins += origins.length;

    const destinations: SuggestionDestination[] = [];
    for (const item of items) {
      const code = storeCode(item.store_code);
      if (selectedDestinations.size > 0 && !selectedDestinations.has(code)) continue;

      const dailySales = numberValue(item.monthly_avg_sales) / 30;
      const stockDays = numberValue(item.stock_days);
      if (dailySales <= 0 || stockDays > needDaysThreshold) continue;

      const need = Math.max(0, Math.ceil((destinationTargetDays - stockDays) * dailySales));
      if (need > 0) destinations.push({ item, need });
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

  for (let from = 0; ; from += chunkSize) {
    const to = from + chunkSize - 1;
    const { data, error } = await supabase
      .from("reallocation_stock_items")
      .select("*")
      .eq("snapshot_id", snapshotId)
      .range(from, to);

    if (error) throw error;

    const chunk = (data || []) as StockItem[];
    rows.push(...chunk);
    if (chunk.length < chunkSize) break;
  }

  return rows;
}

function normalizeTerm(value: unknown) {
  return String(value || "").trim();
}

function mergeProductFilters(filters: {
  products?: string[];
  classifications?: string[];
  manufacturers?: string[];
}, attributeProducts: string[]) {
  const explicitProducts = new Set((filters.products || []).filter(Boolean).map(String));
  const hasAttributeFilters = Boolean(filters.classifications?.length || filters.manufacturers?.length);

  if (!hasAttributeFilters) return Array.from(explicitProducts);

  const attributeSet = new Set(attributeProducts.filter(Boolean).map(String));
  if (explicitProducts.size === 0) return attributeSet.size > 0 ? Array.from(attributeSet) : ["__NO_PRODUCT_MATCH__"];

  const intersection = Array.from(explicitProducts).filter((ean) => attributeSet.has(ean));
  return intersection.length > 0 ? intersection : ["__NO_PRODUCT_MATCH__"];
}

async function fetchProductEansByAttributes(filters: {
  classifications?: string[];
  manufacturers?: string[];
}) {
  const classifications = (filters.classifications || []).map(normalizeTerm).filter(Boolean);
  const manufacturers = (filters.manufacturers || []).map(normalizeTerm).filter(Boolean);

  if (classifications.length === 0 && manufacturers.length === 0) return [];

  const supabase = getSupabaseAdmin();
  const rows: Array<{ ean: string | null }> = [];
  const chunkSize = 1000;

  for (let from = 0; ; from += chunkSize) {
    const to = from + chunkSize - 1;
    let query = supabase
      .from("reallocation_products")
      .select("ean")
      .not("ean", "is", null)
      .range(from, to);

    if (manufacturers.length === 1) {
      query = query.ilike("manufacturer", `%${manufacturers[0]}%`);
    } else if (manufacturers.length > 1) {
      query = query.or(manufacturers.map((term) => `manufacturer.ilike.%${term}%`).join(","));
    }

    if (classifications.length === 1) {
      query = query.ilike("classification", `%${classifications[0]}%`);
    } else if (classifications.length > 1) {
      query = query.or(classifications.map((term) => `classification.ilike.%${term}%`).join(","));
    }

    const { data, error } = await query;
    if (error) throw error;

    const chunk = (data || []) as Array<{ ean: string | null }>;
    rows.push(...chunk);
    if (chunk.length < chunkSize) break;
  }

  return Array.from(new Set(rows.map((row) => row.ean).filter((ean): ean is string => Boolean(ean))));
}

async function calculateWithPython(payload: unknown) {
  const { spawn } = await import("node:child_process");
  const pythonBin = process.env.PYTHON_BIN || "python";
  const scriptPath = process.env.REALLOCATION_ENGINE_PATH || "scripts/reallocation-engine.py";

  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(pythonBin, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const timeout = windowlessTimeout(() => {
      child.kill();
      reject(new Error("Motor Python excedeu o tempo limite."));
    }, 20_000);
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr || `Motor Python finalizou com codigo ${code}.`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error("Motor Python retornou JSON invalido."));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function windowlessTimeout(callback: () => void, delay: number) {
  return setTimeout(callback, delay);
}

export async function POST(request: Request) {
  const auth = await requireAuthenticatedProfile(request);
  if (!auth.ok) return auth.response;

  try {
    const payload = await request.json();
    const stockItems = payload?.snapshotId
      ? await fetchSnapshotStockItems(String(payload.snapshotId))
      : payload?.stockItems;
    const filters = payload?.filters || {};
    const attributeProducts = await fetchProductEansByAttributes(filters);
    const calculationPayload = {
      ...payload,
      filters: {
        ...filters,
        products: mergeProductFilters(filters, attributeProducts),
      },
      stockItems,
    };

    try {
      return NextResponse.json(await calculateWithPython(calculationPayload));
    } catch {
      return NextResponse.json(calculate(calculationPayload));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao gerar sugestoes.";
    return NextResponse.json({ error: message, suggestions: [] }, { status: 400 });
  }
}
