import { NextResponse } from "next/server";
import { requireAuthenticatedProfile } from "@/lib/server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { normalizeReallocationSector } from "@/lib/reallocation-sector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CurrentInventoryRow {
  id: string;
  branch_code: string;
  ean: string;
  erp_code: string | null;
  product_description: string;
  stock_quantity: number | string;
  reserved_quantity: number | string;
  available_quantity: number | string;
  average_cost: number | string;
  sale_price: number | string;
  last_snapshot_id: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

interface SnapshotItemMeta {
  snapshot_id: string;
  branch_code: string;
  branch_name: string;
  ean: string;
  manufacturer: string;
  classification_path: string;
  line: string;
  department: string;
  category: string;
  monthly_avg_sales: number | string;
  daily_avg_sales: number | string;
  stock_days: number | string;
  curve: string | null;
  last_sale_days: number | string;
  last_purchase_days: number | string;
}

interface MetaFilterRow {
  snapshot_id: string;
  branch_code: string;
  ean: string;
}

interface ReallocationStockRow {
  id: string;
  snapshot_id: string;
  store_code: string;
  store_name: string;
  ean: string;
  erp_code: string | null;
  product_description: string;
  stock: number | string;
  confirmed_stock: number | string;
  monthly_avg_sales: number | string;
  stock_days: number | string;
  curve: string | null;
  last_sale_days: number | string;
  last_purchase_days: number | string;
  created_at: string;
}

interface ReallocationProductRow {
  ean: string;
  erp_code: string;
  description: string | null;
  manufacturer: string;
  classification: string;
}

interface PricingBranchRow {
  code: string;
  name: string;
  is_active: boolean;
}

interface PurchaseSuspensionRow {
  branch_code: string;
  ean: string;
  is_suspended: boolean;
}

type SuspendedFilterMode = "yes" | "no" | "all";

interface InventoryFilters {
  branch: string;
  manufacturer: string;
  line: string;
  department: string;
  category: string;
  curve: string;
}

interface InventoryViewItem {
  id: string;
  branch_code: string;
  branch_name: string;
  ean: string;
  erp_code: string | null;
  product_description: string;
  manufacturer: string;
  classification_path: string;
  line: string;
  department: string;
  category: string;
  stock_quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  average_cost: number;
  sale_price: number;
  monthly_avg_sales: number;
  daily_avg_sales: number;
  stock_days: number;
  curve: string;
  last_sale_days: number;
  last_purchase_days: number;
  updated_at: string;
  purchase_suspended: boolean;
}

const CURRENT_SELECT = "id,branch_code,ean,erp_code,product_description,stock_quantity,reserved_quantity,available_quantity,average_cost,sale_price,last_snapshot_id,updated_by,updated_at,created_at";
const META_SELECT = "snapshot_id,branch_code,branch_name,ean,manufacturer,classification_path,line,department,category,monthly_avg_sales,daily_avg_sales,stock_days,curve,last_sale_days,last_purchase_days";
const REALLOCATION_SELECT = "id,snapshot_id,store_code,store_name,ean,erp_code,product_description,stock,confirmed_stock,monthly_avg_sales,stock_days,curve,last_sale_days,last_purchase_days,created_at";
const META_FILTER_SCAN_LIMIT = 25000;
const CURRENT_SCAN_LIMIT = 25000;

function asNumber(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanSearchParam(value: string | null) {
  return String(value || "")
    .replace(/[,%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function metaKey(snapshotId: string | null, branchCode: string, ean: string) {
  return `${snapshotId || ""}::${branchCode}::${ean}`;
}

function hasMetadataFilters(filters: InventoryFilters) {
  return Boolean(filters.manufacturer || filters.line || filters.department || filters.category || filters.curve);
}

function splitClassificationPath(classificationPath: string | null | undefined) {
  const parts = String(classificationPath || "")
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 4) {
    return {
      line: parts[1] || "",
      department: parts[2] || "",
      category: parts.slice(3).join(" > "),
    };
  }

  return {
    line: parts[0] || "",
    department: parts[1] || "",
    category: parts.slice(2).join(" > "),
  };
}

function metadataMatches(meta: SnapshotItemMeta | undefined, filters: InventoryFilters) {
  if (!meta) return !hasMetadataFilters(filters);
  return (!filters.manufacturer || meta.manufacturer === filters.manufacturer)
    && (!filters.line || meta.line === filters.line)
    && (!filters.department || meta.department === filters.department)
    && (!filters.category || meta.category === filters.category)
    && (!filters.curve || (meta.curve || "") === filters.curve);
}

function itemMatchesFilters(item: InventoryViewItem, filters: InventoryFilters) {
  return (!filters.branch || item.branch_code === filters.branch)
    && (!filters.manufacturer || item.manufacturer === filters.manufacturer)
    && (!filters.line || item.line === filters.line)
    && (!filters.department || item.department === filters.department)
    && (!filters.category || item.category === filters.category)
    && (!filters.curve || item.curve === filters.curve);
}

function itemMatchesSearch(item: InventoryViewItem, search: string) {
  if (!search) return true;
  const term = search.toUpperCase();
  return item.product_description.toUpperCase().includes(term)
    || item.ean.toUpperCase().includes(term)
    || String(item.erp_code || "").toUpperCase().includes(term);
}

function cleanSuspendedMode(value: string | null): SuspendedFilterMode {
  if (value === "yes" || value === "all") return value;
  return "no";
}

function suspensionKey(branchCode: string, ean: string) {
  return `${branchCode}::${ean}`;
}

function filterBySuspension(items: InventoryViewItem[], mode: SuspendedFilterMode) {
  if (mode === "all") return items;
  const shouldBeSuspended = mode === "yes";
  return items.filter((item) => item.purchase_suspended === shouldBeSuspended);
}

async function applyPurchaseSuspensions(supabase: ReturnType<typeof getSupabaseAdmin>, items: InventoryViewItem[]) {
  if (!items.length) return items;

  const eans = Array.from(new Set(items.map((item) => item.ean).filter(Boolean)));
  const branchCodes = Array.from(new Set(items.map((item) => item.branch_code).filter(Boolean)));
  const suspendedKeys = new Set<string>();

  try {
    for (const eanChunk of chunkArray(eans, 500)) {
      let query = supabase
        .from("erp_inventory_purchase_suspensions")
        .select("branch_code,ean,is_suspended")
        .eq("is_suspended", true)
        .in("ean", eanChunk);

      if (branchCodes.length > 0 && branchCodes.length <= 500) {
        query = query.in("branch_code", branchCodes);
      }

      const { data, error } = await query;
      if (error) throw error;

      ((data || []) as PurchaseSuspensionRow[]).forEach((row) => {
        if (row.is_suspended) suspendedKeys.add(suspensionKey(row.branch_code, row.ean));
      });
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["42P01", "PGRST205"].includes(String(error.code))) {
      return items.map((item) => ({ ...item, purchase_suspended: false }));
    }
    throw error;
  }

  return items.map((item) => ({
    ...item,
    purchase_suspended: suspendedKeys.has(suspensionKey(item.branch_code, item.ean)),
  }));
}


async function fetchMetadataFilterRows(supabase: ReturnType<typeof getSupabaseAdmin>, filters: InventoryFilters) {
  if (!hasMetadataFilters(filters)) return null;

  let query = supabase
    .from("erp_inventory_snapshot_items")
    .select("snapshot_id,branch_code,ean")
    .limit(META_FILTER_SCAN_LIMIT);

  if (filters.branch) query = query.eq("branch_code", filters.branch);
  if (filters.manufacturer) query = query.eq("manufacturer", filters.manufacturer);
  if (filters.line) query = query.eq("line", filters.line);
  if (filters.department) query = query.eq("department", filters.department);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.curve) query = query.eq("curve", filters.curve);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []) as MetaFilterRow[];
  const keys = new Set(rows.map((row) => metaKey(row.snapshot_id, row.branch_code, row.ean)));
  const eans = Array.from(new Set(rows.map((row) => row.ean).filter(Boolean)));

  return { keys, eans, scanned: rows.length };
}

async function fetchCurrentRows(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  search: string,
  branch: string,
  allowedEans: string[] | null,
) {
  const shouldRestrictByEan = allowedEans && allowedEans.length > 0 && allowedEans.length <= 900;
  const chunks = shouldRestrictByEan ? chunkArray(allowedEans, 300) : [null];
  const rows: CurrentInventoryRow[] = [];
  let totalCount = 0;

  for (const eanChunk of chunks) {
    let query = supabase
      .from("erp_inventory_current")
      .select(CURRENT_SELECT, { count: "exact" })
      .order("updated_at", { ascending: false })
      .limit(CURRENT_SCAN_LIMIT);

    if (branch) query = query.eq("branch_code", branch);
    if (eanChunk) query = query.in("ean", eanChunk);
    if (search) {
      const like = `%${search}%`;
      query = query.or(`product_description.ilike.${like},ean.ilike.${like},erp_code.ilike.${like}`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    rows.push(...((data || []) as CurrentInventoryRow[]));
    totalCount += count || 0;
  }

  return { rows, count: totalCount || rows.length };
}

async function fetchMetadataForRows(supabase: ReturnType<typeof getSupabaseAdmin>, rows: CurrentInventoryRow[]) {
  const snapshotIds = Array.from(new Set(rows.map((row) => row.last_snapshot_id).filter(Boolean))) as string[];
  const eans = Array.from(new Set(rows.map((row) => row.ean).filter(Boolean)));
  const metaByKey = new Map<string, SnapshotItemMeta>();

  if (!snapshotIds.length || !eans.length) return metaByKey;

  for (const snapshotChunk of chunkArray(snapshotIds, 80)) {
    for (const eanChunk of chunkArray(eans, 500)) {
      const { data: metaRows, error: metaError } = await supabase
        .from("erp_inventory_snapshot_items")
        .select(META_SELECT)
        .in("snapshot_id", snapshotChunk)
        .in("ean", eanChunk);

      if (metaError) throw metaError;
      ((metaRows || []) as SnapshotItemMeta[]).forEach((meta) => {
        metaByKey.set(metaKey(meta.snapshot_id, meta.branch_code, meta.ean), meta);
      });
    }
  }

  return metaByKey;
}

function mapErpCurrentRows(rows: CurrentInventoryRow[], metaByKey: Map<string, SnapshotItemMeta>, filters: InventoryFilters, metadataFilter: Awaited<ReturnType<typeof fetchMetadataFilterRows>>) {
  return rows.map((row) => {
    const meta = metaByKey.get(metaKey(row.last_snapshot_id, row.branch_code, row.ean));
    return {
      id: row.id,
      branch_code: row.branch_code,
      branch_name: meta?.branch_name || row.branch_code,
      ean: row.ean,
      erp_code: row.erp_code,
      product_description: row.product_description,
      manufacturer: meta?.manufacturer || "",
      classification_path: meta?.classification_path || "",
      line: meta?.line || "",
      department: meta?.department || "",
      category: meta?.category || "",
      stock_quantity: asNumber(row.stock_quantity),
      reserved_quantity: asNumber(row.reserved_quantity),
      available_quantity: asNumber(row.available_quantity),
      average_cost: asNumber(row.average_cost),
      sale_price: asNumber(row.sale_price),
      monthly_avg_sales: asNumber(meta?.monthly_avg_sales),
      daily_avg_sales: asNumber(meta?.daily_avg_sales),
      stock_days: asNumber(meta?.stock_days),
      curve: meta?.curve || "",
      last_sale_days: asNumber(meta?.last_sale_days),
      last_purchase_days: asNumber(meta?.last_purchase_days),
      updated_at: row.updated_at,
      purchase_suspended: false,
    };
  }).filter((item) => {
    const key = metaKey(rows.find((row) => row.id === item.id)?.last_snapshot_id || null, item.branch_code, item.ean);
    const meta = metaByKey.get(key);
    if (metadataFilter && !metadataFilter.keys.has(key)) return false;
    return metadataMatches(meta, filters);
  });
}

async function findLatestReallocationSnapshotId(supabase: ReturnType<typeof getSupabaseAdmin>, sector: string) {
  const { data: sectorSnapshot, error: sectorError } = await supabase
    .from("reallocation_stock_snapshots")
    .select("id")
    .eq("sector", sector)
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sectorError) throw sectorError;
  if (sectorSnapshot?.id) return String(sectorSnapshot.id);

  const { data: generalSnapshot, error: generalError } = await supabase
    .from("reallocation_stock_snapshots")
    .select("id")
    .eq("sector", "Geral")
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (generalError) throw generalError;
  return generalSnapshot?.id ? String(generalSnapshot.id) : null;
}

async function fetchRegisteredBranch(supabase: ReturnType<typeof getSupabaseAdmin>, branchCode: string) {
  if (!branchCode) return null;

  const { data, error } = await supabase
    .from("pricing_branches")
    .select("code,name,is_active")
    .eq("code", branchCode)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  return data ? data as PricingBranchRow : null;
}

async function fetchProductsByEan(supabase: ReturnType<typeof getSupabaseAdmin>, eans: string[]) {
  const productsByEan = new Map<string, ReallocationProductRow>();

  for (const chunk of chunkArray(Array.from(new Set(eans.filter(Boolean))), 500)) {
    const { data, error } = await supabase
      .from("reallocation_products")
      .select("ean,erp_code,description,manufacturer,classification")
      .in("ean", chunk);

    if (error) throw error;
    ((data || []) as ReallocationProductRow[]).forEach((product) => {
      if (!product.ean) return;
      const current = productsByEan.get(product.ean);
      if (!current || product.manufacturer || product.classification || product.description) {
        productsByEan.set(product.ean, product);
      }
    });
  }

  return productsByEan;
}

async function fetchReallocationFallbackItems(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  sector: string,
  search: string,
  filters: InventoryFilters,
) {
  const snapshotId = await findLatestReallocationSnapshotId(supabase, sector);
  if (!snapshotId) return { rows: [] as InventoryViewItem[], count: 0 };

  let query = supabase
    .from("reallocation_stock_items")
    .select(REALLOCATION_SELECT, { count: "exact" })
    .eq("snapshot_id", snapshotId)
    .order("product_description", { ascending: true })
    .limit(CURRENT_SCAN_LIMIT);

  if (filters.branch) query = query.eq("store_code", filters.branch);
  if (filters.curve) query = query.eq("curve", filters.curve);
  if (search) {
    const like = `%${search}%`;
    query = query.or(`product_description.ilike.${like},ean.ilike.${like},erp_code.ilike.${like}`);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const stockRows = (data || []) as ReallocationStockRow[];
  const productsByEan = await fetchProductsByEan(supabase, stockRows.map((row) => row.ean));

  const rows = stockRows.map((row) => {
    const product = productsByEan.get(row.ean);
    const classificationPath = product?.classification || "";
    const classification = splitClassificationPath(classificationPath);
    const stockQuantity = Math.max(asNumber(row.stock), asNumber(row.confirmed_stock));

    return {
      id: row.id,
      branch_code: row.store_code,
      branch_name: row.store_name,
      ean: row.ean,
      erp_code: row.erp_code || product?.erp_code || null,
      product_description: product?.description || row.product_description,
      manufacturer: product?.manufacturer || "",
      classification_path: classificationPath,
      line: classification.line,
      department: classification.department,
      category: classification.category,
      stock_quantity: stockQuantity,
      reserved_quantity: 0,
      available_quantity: stockQuantity,
      average_cost: 0,
      sale_price: 0,
      monthly_avg_sales: asNumber(row.monthly_avg_sales),
      daily_avg_sales: asNumber(row.monthly_avg_sales) > 0 ? asNumber(row.monthly_avg_sales) / 30 : 0,
      stock_days: asNumber(row.stock_days),
      curve: row.curve || "",
      last_sale_days: asNumber(row.last_sale_days),
      last_purchase_days: asNumber(row.last_purchase_days),
      updated_at: row.created_at,
      purchase_suspended: false,
    };
  }).filter((item) => itemMatchesFilters(item, filters) && itemMatchesSearch(item, search));

  return { rows, count: count || rows.length };
}

async function fetchRegisteredBranchCatalogItems(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  search: string,
  filters: InventoryFilters,
) {
  if (!filters.branch || filters.curve) return { rows: [] as InventoryViewItem[], count: 0 };

  const branch = await fetchRegisteredBranch(supabase, filters.branch);
  if (!branch) return { rows: [] as InventoryViewItem[], count: 0 };

  let query = supabase
    .from("reallocation_products")
    .select("ean,erp_code,description,manufacturer,classification", { count: "exact" })
    .order("description", { ascending: true })
    .limit(CURRENT_SCAN_LIMIT);

  if (filters.manufacturer) query = query.eq("manufacturer", filters.manufacturer);
  if (search) {
    const like = `%${search}%`;
    query = query.or(`description.ilike.${like},ean.ilike.${like},erp_code.ilike.${like},manufacturer.ilike.${like},classification.ilike.${like}`);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const rows = ((data || []) as ReallocationProductRow[]).map((product) => {
    const classification = splitClassificationPath(product.classification || "");

    return {
      id: `catalog-zero-${branch.code}-${product.erp_code}-${product.ean}`,
      branch_code: branch.code,
      branch_name: branch.name,
      ean: product.ean || "",
      erp_code: product.erp_code || null,
      product_description: product.description || product.erp_code || product.ean || "PRODUTO SEM DESCRICAO",
      manufacturer: product.manufacturer || "",
      classification_path: product.classification || "",
      line: classification.line,
      department: classification.department,
      category: classification.category,
      stock_quantity: 0,
      reserved_quantity: 0,
      available_quantity: 0,
      average_cost: 0,
      sale_price: 0,
      monthly_avg_sales: 0,
      daily_avg_sales: 0,
      stock_days: 0,
      curve: "",
      last_sale_days: 0,
      last_purchase_days: 0,
      updated_at: "",
      purchase_suspended: false,
    };
  }).filter((item) => itemMatchesFilters(item, filters) && itemMatchesSearch(item, search));

  return { rows, count: hasMetadataFilters(filters) ? rows.length : count || rows.length };
}
function buildSummary(items: InventoryViewItem[], count: number, metadataFiltered: boolean) {
  const branchMap = new Map<string, string>();
  items.forEach((item) => {
    if (!item.branch_code) return;
    branchMap.set(item.branch_code, item.branch_name || item.branch_code);
  });

  return {
    totalItems: metadataFiltered ? items.length : count,
    listedItems: items.length,
    totalStock: items.reduce((sum, item) => sum + item.stock_quantity, 0),
    totalAvailable: items.reduce((sum, item) => sum + item.available_quantity, 0),
    branches: branchMap.size,
    lastUpdatedAt: items[0]?.updated_at || null,
  };
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const search = cleanSearchParam(url.searchParams.get("search"));
    const filters: InventoryFilters = {
      branch: cleanSearchParam(url.searchParams.get("branch")),
      manufacturer: cleanSearchParam(url.searchParams.get("manufacturer")),
      line: cleanSearchParam(url.searchParams.get("line")),
      department: cleanSearchParam(url.searchParams.get("department")),
      category: cleanSearchParam(url.searchParams.get("category")),
      curve: cleanSearchParam(url.searchParams.get("curve")),
    };
    const suspendedMode = cleanSuspendedMode(url.searchParams.get("suspended"));
    const limitParam = Number(url.searchParams.get("limit") || 1000);
    const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 1000, 50), 2000);
    const supabase = getSupabaseAdmin();

    let erpUnavailable = false;
    let metadataFilter: Awaited<ReturnType<typeof fetchMetadataFilterRows>> = null;
    let enrichedItems: InventoryViewItem[] = [];
    let currentCount = 0;

    try {
      metadataFilter = await fetchMetadataFilterRows(supabase, filters);
      if (!metadataFilter || metadataFilter.eans.length > 0) {
        const { rows, count } = await fetchCurrentRows(supabase, search, filters.branch, metadataFilter?.eans || null);
        const metaByKey = await fetchMetadataForRows(supabase, rows);
        enrichedItems = mapErpCurrentRows(rows, metaByKey, filters, metadataFilter);
        currentCount = count;
      }
    } catch (erpError) {
      if (erpError && typeof erpError === "object" && "code" in erpError && ["42P01", "PGRST205"].includes(String(erpError.code))) {
        erpUnavailable = true;
      } else {
        throw erpError;
      }
    }

    if (erpUnavailable || enrichedItems.length === 0) {
      const fallback = await fetchReallocationFallbackItems(
        supabase,
        normalizeReallocationSector(auth.profile.sector),
        search,
        filters,
      );
      enrichedItems = fallback.rows;
      currentCount = fallback.count;
    }

    if (filters.branch && enrichedItems.length === 0) {
      const catalogFallback = await fetchRegisteredBranchCatalogItems(supabase, search, filters);
      enrichedItems = catalogFallback.rows;
      currentCount = catalogFallback.count;
    }

    enrichedItems = await applyPurchaseSuspensions(supabase, enrichedItems);
    enrichedItems = filterBySuspension(enrichedItems, suspendedMode);
    currentCount = enrichedItems.length;

    const items = enrichedItems.slice(0, limit);
    const summary = buildSummary(enrichedItems, currentCount, true);

    return NextResponse.json({
      items,
      summary,
      missingTable: false,
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["42P01", "PGRST205"].includes(String(error.code))) {
      return NextResponse.json({ items: [], summary: null, missingTable: true });
    }

    const message = error instanceof Error ? error.message : "Nao foi possivel carregar estoque ERP.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}