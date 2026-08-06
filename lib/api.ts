import { supabase } from "@/lib/supabase";
import { getAuthHeaders } from "@/lib/auth-headers";
import { normalizeReallocationSector } from "@/lib/reallocation-sector";
import { DEFAULT_TASK_PRIORITY, normalizeTaskPriority } from "@/lib/task-priority";
import type { AccountStatus, Announcement, AppDbNotification, AuditLog, ExpiringDiscountRule, ExpiringDiscountType, ExpiringInventoryItem, ExpiringRuleScopeType, PricingBranch, PricingMarginRule, PricingProduct, Profile, ReallocationProduct, ReallocationStockItem, ReallocationStockSnapshot, Subtask, SupplierPaymentTerm, Task, TaskHistory, TaskPriority, TaskWorkflowStatus, TradeTaskNote, UserRole } from "@/lib/types";

interface CreateAnnouncementInput {
  title: string;
  content: string;
  createdBy: string;
  sector: string;
  image: File | null;
}

interface CreateTaskInput {
  title: string;
  assignedTo: string;
  category: string;
  notes: string;
  repeatDays: string;
  repeatInterval: number;
  subtasks: Subtask[];
  dueDate: string | null;
  sector: string;
  googleEventId?: string | null;
  googleEventLink?: string | null;
  isOneOff?: boolean;
  priority?: TaskPriority;
}

export interface CreateMeetingInput {
  title: string;
  date: string;
  endDate?: string | null;
  time: string;
  motive: string;
  location: string;
  notes: string;
  assignedTo: string;
  sector: string;
  googleEventId?: string | null;
  googleEventLink?: string | null;
  priority?: TaskPriority;
  tone?: string;
}

interface TaskHistoryInput {
  taskId: string;
  taskTitle: string;
  userName: string;
  userId: string;
  category: string;
  sector: string;
}

interface UpdateTaskInput {
  id: string;
  title: string;
  notes: string;
  assignedTo: string;
  category: string;
  repeatDays: string;
  repeatInterval: number;
  subtasks: Subtask[];
  dueDate?: string | null;
  isOneOff?: boolean;
  sector?: string;
  googleEventId?: string | null;
  googleEventLink?: string | null;
  priority?: TaskPriority;
}

interface UpdateTaskWorkflowInput {
  taskId: string;
  workflowStatus: TaskWorkflowStatus;
  userId?: string | null;
  userName?: string | null;
  blockedReason?: string | null;
}

interface AuditLogInput {  actorId: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  entityTitle?: string | null;
  sector: string;
  details?: string | null;
}

interface CreateAppNotificationInput {
  title: string;
  body: string;
  type: string;
  actorId: string;
  recipientId?: string | null;
  sector?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

export type PricingProductInput = Omit<PricingProduct, "id" | "created_at" | "updated_at"> & {
  id?: string;
};

export type PricingBranchInput = Omit<PricingBranch, "id" | "created_at" | "updated_at"> & {
  id?: string;
};

export type SupplierPaymentTermInput = Omit<SupplierPaymentTerm, "id" | "created_at" | "updated_at"> & {
  id?: string;
};

export type PricingMarginRuleInput = Omit<PricingMarginRule, "id" | "created_at" | "updated_at"> & {
  id?: string;
};

export type ReallocationProductInput = Omit<ReallocationProduct, "id" | "search_text" | "imported_at" | "created_at" | "updated_at"> & {
  id?: string;
};

export type ReallocationProductAttributeField = "manufacturer" | "classification";

export interface ReallocationProductAttributeSummary {
  value: string;
  count: number;
}

interface ReallocationProductFilters {
  searchTerm?: string;
  manufacturers?: string[];
  classifications?: string[];
  classificationLines?: string[];
  classificationDepartments?: string[];
  classificationCategories?: string[];
  limit?: number;
}

export async function fetchProfiles() {
  const { data, error } = await supabase.from("profiles").select("*");
  if (error) throw error;
  return (data || []) as Profile[];
}

export async function fetchCurrentProfile(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) throw error;
  return data as Profile;
}

export async function fetchTasks() {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return ((data || []) as Task[]).filter((task) => !task.archived_at);
}

export async function fetchTaskHistory() {
  const { data, error } = await supabase
    .from("task_history")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data || []) as TaskHistory[];
}

export async function fetchTradeTaskNotes(taskId: string) {
  const { data, error } = await supabase
    .from("trade_task_notes")
    .select("*, profiles(full_name)")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []) as TradeTaskNote[];
}

export async function fetchTradeTaskNoteTaskIds(taskIds: Array<string | number>) {
  if (taskIds.length === 0) return [];

  const { data, error } = await supabase
    .from("trade_task_notes")
    .select("task_id")
    .in("task_id", taskIds);

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw error;
  }

  return Array.from(new Set((data || []).map((row) => String(row.task_id))));
}

export async function createTradeTaskNote(taskId: string, content: string, createdBy: string) {
  const { data, error } = await supabase
    .from("trade_task_notes")
    .insert([{ task_id: taskId, content, created_by: createdBy }])
    .select("*, profiles(full_name)")
    .single();

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      throw new Error("Tabela de notas de Trade ainda não existe no Supabase. Rode o SQL supabase/trade-task-notes.sql.");
    }

    throw new Error(error.message || "Erro ao salvar nota de Trade.");
  }

  return data as TradeTaskNote;
}

export async function deleteTradeTaskNote(noteId: string) {
  const { error } = await supabase.from("trade_task_notes").delete().eq("id", noteId);
  if (error) throw error;
}

export async function fetchAuditLogs() {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(120);

  if (error) throw error;
  return (data || []) as AuditLog[];
}

export async function fetchAnnouncements() {
  const { data, error } = await supabase
    .from("announcements")
    .select("*, profiles(full_name)")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []) as Announcement[];
}

export async function fetchAppNotifications(limit = 80) {
  const { data, error } = await supabase
    .from("app_notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw error;
  }

  return (data || []) as AppDbNotification[];
}

export async function createAppNotification(input: CreateAppNotificationInput) {
  const { error } = await supabase.from("app_notifications").insert([{
    title: input.title,
    body: input.body,
    type: input.type,
    actor_id: input.actorId,
    recipient_id: input.recipientId || null,
    sector: input.sector || null,
    entity_type: input.entityType || null,
    entity_id: input.entityId || null,
  }]);

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return;
    throw error;
  }
}

export async function fetchPricingProducts() {
  const pageSize = 1000;
  const rows: PricingProduct[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("pricing_products")
      .select("*")
      .order("description", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    rows.push(...((data || []) as PricingProduct[]));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

export async function fetchPricingBranches() {
  const { data, error } = await supabase
    .from("pricing_branches")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw error;
  return (data || []) as PricingBranch[];
}

export async function fetchPricingMarginRules() {
  const { data, error } = await supabase
    .from("pricing_margin_rules")
    .select("*")
    .order("line", { ascending: true })
    .order("department", { ascending: true })
    .order("category", { ascending: true });

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw error;
  }

  return (data || []) as PricingMarginRule[];
}

export async function savePricingMarginRule(input: PricingMarginRuleInput) {
  const response = await fetch("/api/pricing/margins", {
    method: "POST",
    headers: {
      ...(await getAuthHeaders()),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || "Erro ao salvar regra de margem.");
  }

  return data.rule as PricingMarginRule;
}

export async function deletePricingMarginRule(ruleId: string) {
  const response = await fetch("/api/pricing/margins", {
    method: "DELETE",
    headers: {
      ...(await getAuthHeaders()),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: ruleId }),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || "Erro ao excluir regra de margem.");
  }
}

export async function savePricingBranch(input: PricingBranchInput) {
  const basicPayload = {
    name: input.name.toUpperCase(),
    code: input.code.toUpperCase(),
    city: input.city.toUpperCase(),
    is_active: input.is_active,
  };
  const payload = {
    ...basicPayload,
    legal_name: input.legal_name.toUpperCase(),
    uf: input.uf.toUpperCase(),
    cnpj: input.cnpj,
    logistics_group: (input.logistics_group || "").toUpperCase(),
    sends_stock: input.sends_stock !== false,
    receives_stock: input.receives_stock !== false,
  };

  if (input.id) {
    let { data, error } = await supabase
      .from("pricing_branches")
      .update(payload)
      .eq("id", input.id)
      .select("*")
      .single();

    if (error?.code === "PGRST204") {
      const fallback = await supabase
        .from("pricing_branches")
        .update(basicPayload)
        .eq("id", input.id)
        .select("*")
        .single();
      data = fallback.data;
      error = fallback.error;
    }

    if (error) throw error;
    return data as PricingBranch;
  }

  let { data, error } = await supabase
    .from("pricing_branches")
    .insert([payload])
    .select("*")
    .single();

  if (error?.code === "PGRST204") {
    const fallback = await supabase
      .from("pricing_branches")
      .insert([basicPayload])
      .select("*")
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  return data as PricingBranch;
}

export async function deletePricingBranch(branchId: string) {
  const { error } = await supabase.from("pricing_branches").delete().eq("id", branchId);
  if (error) throw error;
}

export async function savePricingProduct(input: PricingProductInput) {
  const payload = {
    ean: input.ean,
    description: input.description.toUpperCase(),
    brand: input.brand.toUpperCase(),
    purchase_price: input.purchase_price,
    sell_in_value: input.sell_in_value,
    sell_in_mode: input.sell_in_mode,
    sell_out_value: input.sell_out_value,
    sell_out_mode: input.sell_out_mode,
    trade_value: input.trade_value,
    trade_mode: input.trade_mode,
    sale_price: input.sale_price,
    baby_wednesday_price: input.baby_wednesday_price,
    month_end_price: input.month_end_price,
    competitor_prices: input.competitor_prices,
    store_prices: input.store_prices,
    promotion_group: (input.promotion_group || '').toUpperCase(),
    is_active: input.is_active !== false,
  };

  if (input.id) {
    let { data, error } = await supabase
      .from("pricing_products")
      .update(payload)
      .eq("id", input.id)
      .select("*")
      .single();

    if (error?.code === "PGRST204") {
      const { is_active, promotion_group, ...fallbackPayload } = payload;
      void is_active;
      void promotion_group;
      const fallback = await supabase
        .from("pricing_products")
        .update(fallbackPayload)
        .eq("id", input.id)
        .select("*")
        .single();
      data = fallback.data;
      error = fallback.error;
    }

    if (error) throw error;
    return data as PricingProduct;
  }

  let { data, error } = await supabase
    .from("pricing_products")
    .upsert([payload], { onConflict: "ean" })
    .select("*")
    .single();

  if (error?.code === "PGRST204") {
    const { is_active, promotion_group, ...fallbackPayload } = payload;
    void is_active;
    void promotion_group;
    const fallback = await supabase
      .from("pricing_products")
      .upsert([fallbackPayload], { onConflict: "ean" })
      .select("*")
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  return data as PricingProduct;
}

export async function deletePricingProduct(productId: string) {
  const { error } = await supabase.from("pricing_products").delete().eq("id", productId);
  if (error) throw error;
}


export interface ExpiringDiscountRuleInput {
  id?: string;
  name: string;
  scope_type: ExpiringRuleScopeType;
  scope_value: string;
  discount_type: ExpiringDiscountType;
  discount_value: number;
  min_days_to_expire: number;
  max_days_to_expire: number;
  priority: number;
  is_active: boolean;
}

export async function fetchExpiringInventoryItems() {
  const response = await fetch("/api/expiring-products", { headers: await getAuthHeaders() });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Erro ao carregar pre-vencidos.");
  return {
    items: (data?.items || []) as ExpiringInventoryItem[],
    missingTable: Boolean(data?.missingTable),
  };
}

export async function fetchExpiringDiscountRules() {
  const response = await fetch("/api/expiring-products/rules", { headers: await getAuthHeaders() });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Erro ao carregar regras de pre-vencidos.");
  return {
    rules: (data?.rules || []) as ExpiringDiscountRule[],
    missingTable: Boolean(data?.missingTable),
  };
}

export async function saveExpiringDiscountRule(input: ExpiringDiscountRuleInput) {
  const response = await fetch("/api/expiring-products/rules", {
    method: "POST",
    headers: {
      ...(await getAuthHeaders()),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Erro ao salvar regra de pre-vencidos.");
  return data.rule as ExpiringDiscountRule;
}

export async function deleteExpiringDiscountRule(ruleId: string) {
  const response = await fetch("/api/expiring-products/rules", {
    method: "DELETE",
    headers: {
      ...(await getAuthHeaders()),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: ruleId }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Erro ao excluir regra de pre-vencidos.");
}

export async function fetchSupplierPaymentTerms() {
  const { data, error } = await supabase
    .from("supplier_payment_terms")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("supplier_name", { ascending: true });

  if (error) throw error;
  return (data || []) as SupplierPaymentTerm[];
}

export async function saveSupplierPaymentTerm(input: SupplierPaymentTermInput) {
  const payload = {
    supplier_name: input.supplier_name.toUpperCase(),
    payment_terms: input.payment_terms,
    category: input.category,
    region: input.region,
    min_order_value: input.min_order_value,
    condition_notes: input.condition_notes,
    contact_name: input.contact_name,
    phone: input.phone,
    email: input.email,
    tax_id: input.tax_id,
    is_active: input.is_active,
    sort_order: input.sort_order,
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("supplier_payment_terms")
      .update(payload)
      .eq("id", input.id)
      .select("*")
      .single();

    if (error) throw error;
    return data as SupplierPaymentTerm;
  }

  const { data, error } = await supabase
    .from("supplier_payment_terms")
    .upsert([payload], { onConflict: "supplier_name" })
    .select("*")
    .single();

  if (error) throw error;
  return data as SupplierPaymentTerm;
}

export async function deleteSupplierPaymentTerm(termId: string) {
  const { error } = await supabase.from("supplier_payment_terms").delete().eq("id", termId);
  if (error) throw error;
}

export async function fetchReallocationProducts(searchTermOrFilters: string | ReallocationProductFilters = "", limit = 80) {
  const filters = typeof searchTermOrFilters === "string"
    ? { searchTerm: searchTermOrFilters, limit }
    : searchTermOrFilters;
  let query = supabase
    .from("reallocation_products")
    .select("id,erp_code,ean,description,manufacturer,classification,search_text,source_file,imported_at,created_at,updated_at")
    .order("description", { ascending: true })
    .limit(filters.limit || limit);

  const normalizedSearch = (filters.searchTerm || "").trim();
  if (normalizedSearch) {
    const safeSearch = normalizedSearch.replace(/[%_]/g, "");
    query = query.or(`erp_code.ilike.%${safeSearch}%,ean.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%,manufacturer.ilike.%${safeSearch}%,classification.ilike.%${safeSearch}%`);
  }

  if (filters.manufacturers?.length) {
    const manufacturerTerms = filters.manufacturers
      .map((term) => term.trim().replace(/[%_]/g, ""))
      .filter(Boolean);
    if (manufacturerTerms.length === 1) {
      query = query.ilike("manufacturer", `%${manufacturerTerms[0]}%`);
    } else if (manufacturerTerms.length > 1) {
      query = query.or(manufacturerTerms.map((term) => `manufacturer.ilike.%${term}%`).join(","));
    }
  }

  const classificationFilterTerms = [
    ...(filters.classifications || []),
    ...(filters.classificationLines || []),
    ...(filters.classificationDepartments || []),
    ...(filters.classificationCategories || []),
  ];

  if (classificationFilterTerms.length) {
    const classificationTerms = classificationFilterTerms
      .map((term) => term.trim().replace(/[%_]/g, ""))
      .filter(Boolean);
    if (classificationTerms.length === 1) {
      query = query.ilike("classification", `%${classificationTerms[0]}%`);
    } else if (classificationTerms.length > 1) {
      query = query.or(classificationTerms.map((term) => `classification.ilike.%${term}%`).join(","));
    }
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as ReallocationProduct[];
}

export async function fetchReallocationAttributeOptions(field: "manufacturer" | "classification", searchTerm: string, limit = 200) {
  const options = new Set<string>();
  const normalizedSearch = searchTerm.trim();
  const safeSearch = normalizedSearch.replace(/[%_]/g, "");
  const pageSize = 1000;
  const maxRowsToScan = 8000;

  for (let offset = 0; offset < maxRowsToScan && options.size < limit; offset += pageSize) {
    let query = supabase
      .from("reallocation_products")
      .select(field)
      .neq(field, "")
      .order(field, { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (safeSearch) {
      query = query.ilike(field, `%${safeSearch}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data || []) as Record<string, string>[];
    rows.forEach((row) => {
      const value = String(row[field] || "").trim();
      if (value) options.add(value);
    });

    if (rows.length < pageSize) break;
  }

  return Array.from(options).slice(0, limit);
}

export async function fetchReallocationAttributeSummary(field: ReallocationProductAttributeField) {
  const search = new URLSearchParams({ field });
  const response = await fetch(`/api/reallocation/products/attributes?${search.toString()}`, {
    headers: await getAuthHeaders(),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || "Erro ao carregar resumo do cadastro de produtos.");
  }

  return (data.options || []) as ReallocationProductAttributeSummary[];
}

export async function renameReallocationProductAttribute(input: {
  field: ReallocationProductAttributeField;
  fromValue: string;
  toValue: string;
}) {
  const response = await fetch("/api/reallocation/products/attributes", {
    method: "PATCH",
    headers: {
      ...(await getAuthHeaders()),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || "Erro ao atualizar cadastro de produtos.");
  }

  return data as { updated: number };
}

export async function countReallocationProducts() {
  const { count, error } = await supabase
    .from("reallocation_products")
    .select("id", { count: "exact", head: true });

  if (error) throw error;
  return count || 0;
}

export async function saveReallocationProduct(input: ReallocationProductInput) {
  const response = await fetch("/api/reallocation/products", {
    method: "POST",
    headers: {
      ...(await getAuthHeaders()),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || "Erro ao salvar produto mestre.");
  }

  return data.product as ReallocationProduct;
}

export async function deleteReallocationProduct(productId: string) {
  const response = await fetch("/api/reallocation/products", {
    method: "DELETE",
    headers: {
      ...(await getAuthHeaders()),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: productId }),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || "Erro ao excluir produto mestre.");
  }
}

export async function fetchLatestReallocationStockSnapshot(sector?: string) {
  const normalizedSector = normalizeReallocationSector(sector);
  const query = supabase
    .from("reallocation_stock_snapshots")
    .select("*")
    .eq("sector", normalizedSector)
    .order("imported_at", { ascending: false })
    .limit(1);

  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  return (data || null) as ReallocationStockSnapshot | null;
}

export async function fetchReallocationStockItems(snapshotId: string, searchTerm = "", limit = 200) {
  const normalizedSearch = searchTerm.trim();
  const rows: ReallocationStockItem[] = [];
  const pageSize = Math.min(1000, Math.max(1, limit));
  let lastId = "";

  while (rows.length < limit) {
    let query = supabase
      .from("reallocation_stock_items")
      .select("*")
      .eq("snapshot_id", snapshotId)
      .order("id", { ascending: true })
      .limit(Math.min(pageSize, limit - rows.length));

    if (lastId) {
      query = query.gt("id", lastId);
    }

    if (normalizedSearch) {
      const safeSearch = normalizedSearch.replace(/[%_]/g, "");
      query = query.or(`store_code.ilike.%${safeSearch}%,store_name.ilike.%${safeSearch}%,ean.ilike.%${safeSearch}%,erp_code.ilike.%${safeSearch}%,product_description.ilike.%${safeSearch}%,curve.ilike.%${safeSearch}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const chunk = (data || []) as ReallocationStockItem[];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;

    const nextLastId = chunk[chunk.length - 1]?.id;
    if (!nextLastId || nextLastId === lastId) break;
    lastId = nextLastId;
  }

  return rows.sort((left, right) => (
    left.store_code.localeCompare(right.store_code)
    || left.product_description.localeCompare(right.product_description)
  ));
}

async function updateProfileViaApi(input: {
  profileId: string;
  fullName?: string;
  role?: UserRole;
  sector?: string;
  accountStatus?: AccountStatus;
  isActive?: boolean;
}) {
  const response = await fetch("/api/profiles", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || "Erro ao atualizar perfil.");
  }

  return data?.profile as Profile | undefined;
}

export async function updateProfileName(userId: string, fullName: string) {
  await updateProfileViaApi({ profileId: userId, fullName });
}

export async function updateProfileRole(profileId: string, role: UserRole) {
  await updateProfileViaApi({ profileId, role });
}

export async function updateProfileSector(profileId: string, sector: string) {
  await updateProfileViaApi({ profileId, sector });
}

export async function updateProfileAccountStatus(profileId: string, accountStatus: AccountStatus) {
  await updateProfileViaApi({ profileId, accountStatus });
}

export async function updateProfileActive(profileId: string, isActive: boolean) {
  await updateProfileViaApi({ profileId, isActive });
}

export async function deleteAnnouncement(announcementId: string) {
  const { error } = await supabase.from("announcements").delete().eq("id", announcementId);
  if (error) throw error;
}

export async function createAnnouncement({ title, content, createdBy, sector, image }: CreateAnnouncementInput) {
  let publicUrl: string | null = null;

  if (image) {
    const fileExt = image.name.split(".").pop();
    const fileName = `${Math.random()}.${fileExt}`;
    const filePath = `alerts/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from("announcement-images")
      .upload(filePath, image);

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from("announcement-images").getPublicUrl(filePath);
    publicUrl = data.publicUrl;
  }

  const { error } = await supabase.from("announcements").insert([{
    title: title.toUpperCase(),
    content,
    created_by: createdBy,
    sector,
    image_url: publicUrl,
  }]);

  if (error) throw error;
}

export async function createTask(input: CreateTaskInput) {
  const payload = {
    title: input.title.toUpperCase(),
    assigned_to: input.assignedTo,
    status: "pendente",
    category: input.category,
    notes: input.notes,
    repeat_days: input.repeatDays,
    repeat_interval: input.repeatInterval,
    subtasks: input.subtasks,
    due_date: input.dueDate,
    sector: input.sector,
    google_event_id: input.googleEventId || null,
    google_event_link: input.googleEventLink || null,
    is_one_off: input.isOneOff || false,
    priority: normalizeTaskPriority(input.priority || DEFAULT_TASK_PRIORITY),
    workflow_status: "pendente" as TaskWorkflowStatus,
    workflow_started_by: null,
    workflow_started_by_name: null,
    workflow_started_at: null,
    workflow_blocked_reason: null,
  };

  let { error } = await supabase.from("tasks").insert([payload]);

  if (error?.code === "PGRST204") {
    const { priority, workflow_status, workflow_started_by, workflow_started_by_name, workflow_started_at, workflow_blocked_reason, ...fallbackPayload } = payload;
    void priority;
    void workflow_status;
    void workflow_started_by;
    void workflow_started_by_name;
    void workflow_started_at;
    void workflow_blocked_reason;
    const fallback = await supabase.from("tasks").insert([fallbackPayload]);
    error = fallback.error;
  }

  if (error) {
    if (error.code === "PGRST204") {
      throw new Error("Campos de tarefa pontual ainda não existem no Supabase. Rode o SQL supabase/task-one-off-archive.sql.");
    }

    throw new Error(error.message || "Erro ao criar tarefa.");
  }
}

export async function createMeeting(input: CreateMeetingInput) {
  const details = [
    `Horário: ${input.time}`,
    input.endDate && input.endDate !== input.date ? `Data final: ${input.endDate}` : null,
    `Motivo: ${input.motive}`,
    input.location ? `Local: ${input.location}` : null,
    input.notes ? `Observações: ${input.notes}` : null,
    input.tone ? `Cor: ${input.tone}` : null,
  ].filter(Boolean).join("\n");

  await createTask({
    title: input.title,
    assignedTo: input.assignedTo,
    category: "Reunião",
    notes: details,
    repeatDays: "",
    repeatInterval: 1,
    subtasks: [],
    dueDate: input.date,
    sector: input.sector,
    googleEventId: input.googleEventId || null,
    googleEventLink: input.googleEventLink || null,
  });
}

export async function addTaskHistory(input: TaskHistoryInput) {
  const { error } = await supabase.from("task_history").insert([{
    task_id: input.taskId,
    task_title: input.taskTitle,
    user_name: input.userName,
    user_id: input.userId,
    category: input.category,
    sector: input.sector,
  }]);

  if (error) throw error;
}

export async function addAuditLog(input: AuditLogInput) {
  const { error } = await supabase.from("audit_logs").insert([{
    actor_id: input.actorId,
    actor_name: input.actorName,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId || null,
    entity_title: input.entityTitle || null,
    sector: input.sector,
    details: input.details || null,
  }]);

  if (error) throw error;
}

export async function updateTaskCompletion(taskId: string, lastDoneDate: string | null, subtasks: Subtask[], archiveCompleted = false) {
  const payload = {
    last_done_date: lastDoneDate,
    status: lastDoneDate ? "concluido" : "pendente",
    subtasks,
    schedule_override_date: null,
    schedule_override_type: null,
    archived_at: archiveCompleted && lastDoneDate ? new Date().toISOString() : null,
    workflow_status: (lastDoneDate ? "concluida" : "pendente") as TaskWorkflowStatus,
    workflow_started_by: null,
    workflow_started_by_name: null,
    workflow_started_at: null,
    workflow_blocked_reason: null,
  };

  let { error } = await supabase.from("tasks").update(payload).eq("id", taskId);

  if (error?.code === "PGRST204") {
    const { workflow_status, workflow_started_by, workflow_started_by_name, workflow_started_at, workflow_blocked_reason, ...fallbackPayload } = payload;
    void workflow_status;
    void workflow_started_by;
    void workflow_started_by_name;
    void workflow_started_at;
    void workflow_blocked_reason;

    const fallback = await supabase.from("tasks").update(fallbackPayload).eq("id", taskId);
    error = fallback.error;
  }

  if (error?.code === "PGRST204") {
    if (archiveCompleted) {
      throw new Error("Campos de tarefa pontual ainda nao existem no Supabase. Rode o SQL supabase/task-one-off-archive.sql.");
    }

    const fallback = await supabase.from("tasks").update({
      last_done_date: lastDoneDate,
      status: lastDoneDate ? "concluido" : "pendente",
      subtasks,
    }).eq("id", taskId);
    error = fallback.error;
  }

  if (error) throw error;
}

export async function updateTaskSubtasks(taskId: string, subtasks: Subtask[]) {
  const { error } = await supabase.from("tasks").update({ subtasks }).eq("id", taskId);
  if (error) throw error;
}

export async function updateTaskWorkflow(input: UpdateTaskWorkflowInput) {
  const now = new Date().toISOString();
  const isPending = input.workflowStatus === "pendente";
  const payload = {
    workflow_status: input.workflowStatus,
    workflow_started_by: isPending ? null : input.userId || null,
    workflow_started_by_name: isPending ? null : input.userName || null,
    workflow_started_at: isPending ? null : now,
    workflow_blocked_reason: input.workflowStatus === "bloqueada" ? input.blockedReason || null : null,
  };

  const { error } = await supabase.from("tasks").update(payload).eq("id", input.taskId);

  if (error) {
    if (error.code === "PGRST204") {
      throw new Error("Campos de status da tarefa ainda nao existem no Supabase. Rode o SQL supabase/task-workflow-status.sql.");
    }

    throw new Error(error.message || "Erro ao alterar status da tarefa.");
  }
}
export async function updateTaskScheduleOverride(
  taskId: string,
  scheduleOverrideDate: string | null,
  scheduleOverrideType: "advanced" | "postponed" | null,
) {
  const { error } = await supabase.from("tasks").update({
    schedule_override_date: scheduleOverrideDate,
    schedule_override_type: scheduleOverrideType,
  }).eq("id", taskId);

  if (error) {
    if (error.code === "PGRST204") {
      throw new Error("Campos de adiantar/adiar ainda não existem no Supabase. Rode o SQL supabase/task-schedule-overrides.sql.");
    }

    throw new Error(error.message || "Erro ao salvar ajuste de agenda.");
  }
}

export async function deleteTask(taskId: string) {
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) throw error;
}

export async function updateTask(input: UpdateTaskInput) {
  const payload = {
    title: input.title.toUpperCase(),
    notes: input.notes,
    assigned_to: input.assignedTo,
    category: input.category,
    repeat_days: input.repeatDays,
    repeat_interval: input.repeatInterval,
    subtasks: input.subtasks,
    ...(input.dueDate !== undefined ? { due_date: input.dueDate } : {}),
    ...(input.isOneOff !== undefined ? { is_one_off: input.isOneOff } : {}),
    ...(input.sector !== undefined ? { sector: input.sector } : {}),
    ...(input.googleEventId !== undefined ? { google_event_id: input.googleEventId } : {}),
    ...(input.googleEventLink !== undefined ? { google_event_link: input.googleEventLink } : {}),
    ...(input.priority !== undefined ? { priority: normalizeTaskPriority(input.priority) } : {}),
  };

  let { error } = await supabase
    .from("tasks")
    .update(payload)
    .eq("id", input.id);

  if (error?.code === "PGRST204" && input.priority !== undefined) {
    const { priority, ...fallbackPayload } = payload;
    void priority;
    const fallback = await supabase
      .from("tasks")
      .update(fallbackPayload)
      .eq("id", input.id);
    error = fallback.error;
  }

  if (error) throw error;
}
