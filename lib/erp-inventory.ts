import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { ErpInventoryBranchScope, ErpInventoryMovementType } from "@/lib/types";

const DEFAULT_CHUNK_SIZE = 1000;

export interface ErpInventorySnapshotItemInput {
  branchCode: string;
  branchName: string;
  ean: string;
  erpCode?: string | null;
  productDescription: string;
  manufacturer?: string | null;
  classificationPath?: string | null;
  line?: string | null;
  department?: string | null;
  category?: string | null;
  stockQuantity?: number | null;
  confirmedQuantity?: number | null;
  reservedQuantity?: number | null;
  monthlyAvgSales?: number | null;
  dailyAvgSales?: number | null;
  stockDays?: number | null;
  curve?: string | null;
  lastSaleDays?: number | null;
  lastPurchaseDays?: number | null;
  lastPurchaseSupplier?: string | null;
  costPrice?: number | null;
  salePrice?: number | null;
  minStock?: number | null;
  maxStock?: number | null;
  rawPayload?: Record<string, unknown> | null;
}

export interface CreateErpInventorySnapshotInput {
  sourceModule: string;
  sourceFile?: string | null;
  sector?: string | null;
  branchScope?: ErpInventoryBranchScope | null;
  importedBy?: string | null;
  expiresAt?: string | null;
  notes?: string | null;
  items: ErpInventorySnapshotItemInput[];
  writeImportMovements?: boolean;
}

export interface ErpInventoryMovementInput {
  movementType: ErpInventoryMovementType;
  branchCode: string;
  ean: string;
  erpCode?: string | null;
  quantity: number;
  unitCost?: number | null;
  unitPrice?: number | null;
  sourceModule?: string | null;
  sourceProcessId?: string | null;
  sourceItemId?: string | null;
  relatedBranchCode?: string | null;
  documentNumber?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}

export interface ErpInventorySnapshotResult {
  snapshotId: string;
  imported: number;
  currentUpdated: number;
  movementsCreated: number;
}

function chunkArray<T>(items: T[], chunkSize = DEFAULT_CHUNK_SIZE) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function normalizeText(value: string | null | undefined) {
  return String(value || "").trim();
}

function normalizeNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value;
}

function normalizeNullableText(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function inferBranchScope(items: ErpInventorySnapshotItemInput[]): ErpInventoryBranchScope {
  const branches = new Set(items.map((item) => normalizeText(item.branchCode)).filter(Boolean));
  return branches.size <= 1 ? "single_branch" : "multi_branch";
}

export function splitErpClassificationPath(classificationPath: string | null | undefined) {
  const parts = normalizeText(classificationPath)
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

function mapSnapshotItem(snapshotId: string, item: ErpInventorySnapshotItemInput) {
  const classification = splitErpClassificationPath(item.classificationPath);
  const stockQuantity = normalizeNumber(item.stockQuantity);
  const confirmedQuantity = normalizeNumber(item.confirmedQuantity);
  const dailyAvgSales = normalizeNumber(item.dailyAvgSales)
    || (normalizeNumber(item.monthlyAvgSales) > 0 ? normalizeNumber(item.monthlyAvgSales) / 30 : 0);

  return {
    snapshot_id: snapshotId,
    branch_code: normalizeText(item.branchCode),
    branch_name: normalizeText(item.branchName),
    ean: normalizeText(item.ean),
    erp_code: normalizeNullableText(item.erpCode),
    product_description: normalizeText(item.productDescription),
    manufacturer: normalizeText(item.manufacturer),
    classification_path: normalizeText(item.classificationPath),
    line: normalizeText(item.line) || classification.line,
    department: normalizeText(item.department) || classification.department,
    category: normalizeText(item.category) || classification.category,
    stock_quantity: stockQuantity,
    confirmed_quantity: confirmedQuantity,
    reserved_quantity: normalizeNumber(item.reservedQuantity),
    monthly_avg_sales: normalizeNumber(item.monthlyAvgSales),
    daily_avg_sales: dailyAvgSales,
    stock_days: normalizeNumber(item.stockDays),
    curve: normalizeNullableText(item.curve),
    last_sale_days: normalizeNumber(item.lastSaleDays),
    last_purchase_days: normalizeNumber(item.lastPurchaseDays),
    last_purchase_supplier: normalizeNullableText(item.lastPurchaseSupplier),
    cost_price: normalizeNumber(item.costPrice),
    sale_price: normalizeNumber(item.salePrice),
    min_stock: normalizeNumber(item.minStock),
    max_stock: normalizeNumber(item.maxStock),
    raw_payload: item.rawPayload || {},
  };
}

function currentStockQuantity(item: ReturnType<typeof mapSnapshotItem>) {
  return Math.max(item.stock_quantity, item.confirmed_quantity);
}

function mapCurrentItem(snapshotId: string, importedBy: string | null | undefined, item: ReturnType<typeof mapSnapshotItem>) {
  return {
    branch_code: item.branch_code,
    ean: item.ean,
    erp_code: item.erp_code,
    product_description: item.product_description,
    stock_quantity: currentStockQuantity(item),
    reserved_quantity: item.reserved_quantity,
    average_cost: item.cost_price,
    sale_price: item.sale_price,
    last_snapshot_id: snapshotId,
    updated_by: importedBy || null,
  };
}

function dedupeCurrentItems(items: ReturnType<typeof mapCurrentItem>[]) {
  const deduped = new Map<string, ReturnType<typeof mapCurrentItem>>();

  items.forEach((item) => {
    if (!item.branch_code || !item.ean) return;
    deduped.set(`${item.branch_code}::${item.ean}`, item);
  });

  return Array.from(deduped.values());
}

function mapImportMovement(
  snapshotId: string,
  importedBy: string | null | undefined,
  sourceModule: string,
  item: ReturnType<typeof mapSnapshotItem>,
) {
  return {
    movement_type: "import" satisfies ErpInventoryMovementType,
    branch_code: item.branch_code,
    ean: item.ean,
    erp_code: item.erp_code,
    quantity: currentStockQuantity(item),
    unit_cost: item.cost_price,
    unit_price: item.sale_price,
    source_module: sourceModule,
    source_process_id: snapshotId,
    source_item_id: null,
    related_branch_code: null,
    document_number: null,
    notes: "Snapshot de importacao de estoque",
    created_by: importedBy || null,
  };
}

export async function createErpInventorySnapshot(input: CreateErpInventorySnapshotInput): Promise<ErpInventorySnapshotResult> {
  const validItems = input.items.filter((item) => normalizeText(item.branchCode) && normalizeText(item.ean));

  if (!validItems.length) {
    throw new Error("Nenhum item valido para criar snapshot de estoque ERP.");
  }

  const supabase = getSupabaseAdmin();
  let snapshotId: string | null = null;

  try {
    const { data: snapshot, error: snapshotError } = await supabase
      .from("erp_inventory_snapshots")
      .insert([{
        source_module: normalizeText(input.sourceModule) || "manual",
        source_file: normalizeNullableText(input.sourceFile),
        sector: normalizeText(input.sector) || "Geral",
        branch_scope: input.branchScope || inferBranchScope(validItems),
        imported_by: input.importedBy || null,
        expires_at: input.expiresAt || null,
        notes: normalizeNullableText(input.notes),
      }])
      .select("id")
      .single();

    if (snapshotError) throw snapshotError;
    const createdSnapshotId = String(snapshot.id);
    snapshotId = createdSnapshotId;

    const snapshotItems = validItems.map((item) => mapSnapshotItem(createdSnapshotId, item));

    for (const chunk of chunkArray(snapshotItems)) {
      const { error } = await supabase.from("erp_inventory_snapshot_items").insert(chunk);
      if (error) throw error;
    }

    const currentItems = dedupeCurrentItems(
      snapshotItems.map((item) => mapCurrentItem(createdSnapshotId, input.importedBy, item)),
    );

    for (const chunk of chunkArray(currentItems)) {
      const { error } = await supabase
        .from("erp_inventory_current")
        .upsert(chunk, { onConflict: "branch_code,ean" });
      if (error) throw error;
    }

    let movementsCreated = 0;
    if (input.writeImportMovements) {
      const movements = snapshotItems.map((item) => mapImportMovement(
        createdSnapshotId,
        input.importedBy,
        normalizeText(input.sourceModule) || "manual",
        item,
      ));

      for (const chunk of chunkArray(movements)) {
        const { error } = await supabase.from("erp_inventory_movements").insert(chunk);
        if (error) throw error;
        movementsCreated += chunk.length;
      }
    }

    return {
      snapshotId: createdSnapshotId,
      imported: snapshotItems.length,
      currentUpdated: currentItems.length,
      movementsCreated,
    };
  } catch (error) {
    if (snapshotId) {
      await supabase.from("erp_inventory_snapshots").delete().eq("id", snapshotId);
    }

    throw error;
  }
}

export async function recordInventoryMovement(input: ErpInventoryMovementInput) {
  const supabase = getSupabaseAdmin();
  const quantity = normalizeNumber(input.quantity);

  if (!normalizeText(input.branchCode) || !normalizeText(input.ean) || quantity === 0) {
    throw new Error("Movimento de estoque ERP precisa ter loja, EAN e quantidade.");
  }

  const { data, error } = await supabase
    .from("erp_inventory_movements")
    .insert([{
      movement_type: input.movementType,
      branch_code: normalizeText(input.branchCode),
      ean: normalizeText(input.ean),
      erp_code: normalizeNullableText(input.erpCode),
      quantity,
      unit_cost: normalizeNumber(input.unitCost),
      unit_price: normalizeNumber(input.unitPrice),
      source_module: normalizeText(input.sourceModule) || "manual",
      source_process_id: input.sourceProcessId || null,
      source_item_id: input.sourceItemId || null,
      related_branch_code: normalizeNullableText(input.relatedBranchCode),
      document_number: normalizeNullableText(input.documentNumber),
      notes: normalizeNullableText(input.notes),
      created_by: input.createdBy || null,
    }])
    .select("id")
    .single();

  if (error) throw error;
  return data;
}


