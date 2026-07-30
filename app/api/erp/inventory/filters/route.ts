import { NextResponse } from "next/server";
import { requireAuthenticatedProfile } from "@/lib/server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { normalizeReallocationSector } from "@/lib/reallocation-sector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SnapshotFilterRow {
  branch_code: string;
  branch_name: string;
  manufacturer: string;
  line: string;
  department: string;
  category: string;
  curve: string | null;
}

interface ReallocationStockFilterRow {
  store_code: string;
  store_name: string;
  ean: string;
  erp_code: string | null;
  curve: string | null;
}

interface ReallocationProductRow {
  ean: string;
  erp_code: string;
  manufacturer: string;
  classification: string;
}

interface PricingBranchRow {
  code: string;
  name: string;
  is_active: boolean;
}

interface InventoryFilterValues {
  branch: string;
  manufacturer: string;
  line: string;
  department: string;
  category: string;
  curve: string;
}

const SCAN_PAGE_SIZE = 1000;
const MAX_SCAN_ROWS = 60000;

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

function addOption(map: Map<string, string>, value: string | null, label?: string | null) {
  const normalized = String(value || "").trim();
  if (!normalized) return;
  map.set(normalized, String(label || normalized).trim() || normalized);
}

function toOptions(map: Map<string, string>) {
  return Array.from(map.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
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

function matchesFilters(row: SnapshotFilterRow, filters: InventoryFilterValues) {
  return (!filters.branch || row.branch_code === filters.branch)
    && (!filters.manufacturer || row.manufacturer === filters.manufacturer)
    && (!filters.line || row.line === filters.line)
    && (!filters.department || row.department === filters.department)
    && (!filters.category || row.category === filters.category)
    && (!filters.curve || (row.curve || "") === filters.curve);
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

async function fetchProductsByEan(supabase: ReturnType<typeof getSupabaseAdmin>, eans: string[]) {
  const productsByEan = new Map<string, ReallocationProductRow>();

  for (const chunk of chunkArray(Array.from(new Set(eans.filter(Boolean))), 500)) {
    const { data, error } = await supabase
      .from("reallocation_products")
      .select("ean,erp_code,manufacturer,classification")
      .in("ean", chunk);

    if (error) throw error;
    ((data || []) as ReallocationProductRow[]).forEach((product) => {
      if (!product.ean) return;
      const current = productsByEan.get(product.ean);
      if (!current || product.manufacturer || product.classification) {
        productsByEan.set(product.ean, product);
      }
    });
  }

  return productsByEan;
}

async function addRegisteredBranchOptions(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  filters: InventoryFilterValues,
  branches: Map<string, string>,
) {
  let query = supabase
    .from("pricing_branches")
    .select("code,name,is_active")
    .eq("is_active", true)
    .order("code", { ascending: true });

  if (filters.branch) query = query.eq("code", filters.branch);

  const { data, error } = await query;
  if (error) throw error;

  ((data || []) as PricingBranchRow[]).forEach((branch) => {
    addOption(branches, branch.code, branch.name ? `${branch.code} - ${branch.name}` : branch.code);
  });
}
async function addReallocationFallbackOptions(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  sector: string,
  filters: InventoryFilterValues,
  maps: {
    branches: Map<string, string>;
    manufacturers: Map<string, string>;
    lines: Map<string, string>;
    departments: Map<string, string>;
    categories: Map<string, string>;
    curves: Map<string, string>;
  },
) {
  const snapshotId = await findLatestReallocationSnapshotId(supabase, sector);
  if (!snapshotId) return;

  const allRows: ReallocationStockFilterRow[] = [];

  for (let offset = 0; offset < MAX_SCAN_ROWS; offset += SCAN_PAGE_SIZE) {
    let query = supabase
      .from("reallocation_stock_items")
      .select("store_code,store_name,ean,erp_code,curve")
      .eq("snapshot_id", snapshotId)
      .range(offset, offset + SCAN_PAGE_SIZE - 1);

    if (filters.branch) query = query.eq("store_code", filters.branch);
    if (filters.curve) query = query.eq("curve", filters.curve);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data || []) as ReallocationStockFilterRow[];
    allRows.push(...rows);
    if (rows.length < SCAN_PAGE_SIZE) break;
  }

  const productsByEan = await fetchProductsByEan(supabase, allRows.map((row) => row.ean));

  allRows.forEach((row) => {
    const product = productsByEan.get(row.ean);
    const classification = splitClassificationPath(product?.classification || "");
    const normalized: SnapshotFilterRow = {
      branch_code: row.store_code,
      branch_name: row.store_name,
      manufacturer: product?.manufacturer || "",
      line: classification.line,
      department: classification.department,
      category: classification.category,
      curve: row.curve || "",
    };

    if (!matchesFilters(normalized, filters)) return;

    addOption(maps.branches, normalized.branch_code, normalized.branch_name ? `${normalized.branch_code} - ${normalized.branch_name}` : normalized.branch_code);
    addOption(maps.manufacturers, normalized.manufacturer);
    addOption(maps.lines, normalized.line);
    addOption(maps.departments, normalized.department);
    addOption(maps.categories, normalized.category);
    addOption(maps.curves, normalized.curve || "");
  });
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const filters: InventoryFilterValues = {
      branch: cleanSearchParam(url.searchParams.get("branch")),
      manufacturer: cleanSearchParam(url.searchParams.get("manufacturer")),
      line: cleanSearchParam(url.searchParams.get("line")),
      department: cleanSearchParam(url.searchParams.get("department")),
      category: cleanSearchParam(url.searchParams.get("category")),
      curve: cleanSearchParam(url.searchParams.get("curve")),
    };
    const supabase = getSupabaseAdmin();

    const branches = new Map<string, string>();
    const manufacturers = new Map<string, string>();
    const lines = new Map<string, string>();
    const departments = new Map<string, string>();
    const categories = new Map<string, string>();
    const curves = new Map<string, string>();
    const maps = { branches, manufacturers, lines, departments, categories, curves };

    try {
      for (let offset = 0; offset < MAX_SCAN_ROWS; offset += SCAN_PAGE_SIZE) {
        let query = supabase
          .from("erp_inventory_snapshot_items")
          .select("branch_code,branch_name,manufacturer,line,department,category,curve")
          .range(offset, offset + SCAN_PAGE_SIZE - 1);

        if (filters.branch) query = query.eq("branch_code", filters.branch);
        if (filters.manufacturer) query = query.eq("manufacturer", filters.manufacturer);
        if (filters.line) query = query.eq("line", filters.line);
        if (filters.department) query = query.eq("department", filters.department);
        if (filters.category) query = query.eq("category", filters.category);
        if (filters.curve) query = query.eq("curve", filters.curve);

        const { data, error } = await query;
        if (error) throw error;

        const rows = (data || []) as SnapshotFilterRow[];
        rows.forEach((row) => {
          addOption(branches, row.branch_code, row.branch_name ? `${row.branch_code} - ${row.branch_name}` : row.branch_code);
          addOption(manufacturers, row.manufacturer);
          addOption(lines, row.line);
          addOption(departments, row.department);
          addOption(categories, row.category);
          addOption(curves, row.curve || "");
        });

        if (rows.length < SCAN_PAGE_SIZE) break;
      }
    } catch (erpError) {
      if (!(erpError && typeof erpError === "object" && "code" in erpError && ["42P01", "PGRST205"].includes(String(erpError.code)))) {
        throw erpError;
      }
    }

    await addRegisteredBranchOptions(supabase, filters, branches);

    await addReallocationFallbackOptions(
      supabase,
      normalizeReallocationSector(auth.profile.sector),
      filters,
      maps,
    );

    return NextResponse.json({
      missingTable: false,
      branches: toOptions(branches),
      manufacturers: toOptions(manufacturers),
      lines: toOptions(lines),
      departments: toOptions(departments),
      categories: toOptions(categories),
      curves: toOptions(curves),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel carregar filtros do estoque ERP.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}