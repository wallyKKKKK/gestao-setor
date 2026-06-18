import { supabase } from "@/lib/supabase";
import type { AccountStatus, Announcement, AppDbNotification, AuditLog, PricingBranch, PricingProduct, Profile, ReallocationProduct, ReallocationStockItem, ReallocationStockSnapshot, Subtask, SupplierPaymentTerm, Task, TaskHistory, TradeTaskNote, UserRole } from "@/lib/types";

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
}

export interface CreateMeetingInput {
  title: string;
  date: string;
  time: string;
  motive: string;
  location: string;
  notes: string;
  assignedTo: string;
  sector: string;
  googleEventId?: string | null;
  googleEventLink?: string | null;
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
}

interface AuditLogInput {
  actorId: string;
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

interface ReallocationProductFilters {
  searchTerm?: string;
  manufacturers?: string[];
  classifications?: string[];
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
  const { data, error } = await supabase
    .from("pricing_products")
    .select("*")
    .order("description", { ascending: true });

  if (error) throw error;
  return (data || []) as PricingProduct[];
}

export async function fetchPricingBranches() {
  const { data, error } = await supabase
    .from("pricing_branches")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw error;
  return (data || []) as PricingBranch[];
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
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("pricing_products")
      .update(payload)
      .eq("id", input.id)
      .select("*")
      .single();

    if (error) throw error;
    return data as PricingProduct;
  }

  const { data, error } = await supabase
    .from("pricing_products")
    .upsert([payload], { onConflict: "ean" })
    .select("*")
    .single();

  if (error) throw error;
  return data as PricingProduct;
}

export async function deletePricingProduct(productId: string) {
  const { error } = await supabase.from("pricing_products").delete().eq("id", productId);
  if (error) throw error;
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
    .select("*")
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

  if (filters.classifications?.length) {
    const classificationTerms = filters.classifications
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
  let query = supabase
    .from("reallocation_products")
    .select(field)
    .neq(field, "")
    .order(field, { ascending: true })
    .limit(limit);

  const normalizedSearch = searchTerm.trim();
  if (normalizedSearch) {
    const safeSearch = normalizedSearch.replace(/[%_]/g, "");
    query = query.ilike(field, `%${safeSearch}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  return Array.from(new Set(((data || []) as Record<string, string>[]).map((row) => String(row[field] || "").trim()).filter(Boolean)));
}

export async function countReallocationProducts() {
  const { count, error } = await supabase
    .from("reallocation_products")
    .select("id", { count: "exact", head: true });

  if (error) throw error;
  return count || 0;
}

export async function fetchLatestReallocationStockSnapshot() {
  const { data, error } = await supabase
    .from("reallocation_stock_snapshots")
    .select("*")
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data || null) as ReallocationStockSnapshot | null;
}

export async function fetchReallocationStockItems(snapshotId: string, searchTerm = "", limit = 200) {
  let query = supabase
    .from("reallocation_stock_items")
    .select("*")
    .eq("snapshot_id", snapshotId)
    .order("store_code", { ascending: true })
    .order("product_description", { ascending: true })
    .limit(limit);

  const normalizedSearch = searchTerm.trim();
  if (normalizedSearch) {
    const safeSearch = normalizedSearch.replace(/[%_]/g, "");
    query = query.or(`store_code.ilike.%${safeSearch}%,store_name.ilike.%${safeSearch}%,ean.ilike.%${safeSearch}%,erp_code.ilike.%${safeSearch}%,product_description.ilike.%${safeSearch}%,curve.ilike.%${safeSearch}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as ReallocationStockItem[];
}

export async function updateProfileName(userId: string, fullName: string) {
  const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", userId);
  if (error) throw error;
}

export async function updateProfileRole(profileId: string, role: UserRole) {
  const { error } = await supabase.from("profiles").update({ role }).eq("id", profileId);
  if (error) throw error;
}

export async function updateProfileSector(profileId: string, sector: string) {
  const { error } = await supabase.from("profiles").update({ sector }).eq("id", profileId);
  if (error) throw error;
}

export async function updateProfileAccountStatus(profileId: string, accountStatus: AccountStatus) {
  const { error } = await supabase.from("profiles").update({ account_status: accountStatus }).eq("id", profileId);
  if (error) throw error;
}

export async function updateProfileActive(profileId: string, isActive: boolean) {
  const { error } = await supabase.from("profiles").update({ is_active: isActive }).eq("id", profileId);
  if (error) throw error;
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
  const { error } = await supabase.from("tasks").insert([{
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
  }]);

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
    `Motivo: ${input.motive}`,
    input.location ? `Local: ${input.location}` : null,
    input.notes ? `Observações: ${input.notes}` : null,
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
  let { error } = await supabase.from("tasks").update({
    last_done_date: lastDoneDate,
    status: lastDoneDate ? "concluido" : "pendente",
    subtasks,
    schedule_override_date: null,
    schedule_override_type: null,
    archived_at: archiveCompleted && lastDoneDate ? new Date().toISOString() : null,
  }).eq("id", taskId);

  if (error?.code === "PGRST204") {
    if (archiveCompleted) {
      throw new Error("Campos de tarefa pontual ainda não existem no Supabase. Rode o SQL supabase/task-one-off-archive.sql.");
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
  const { error } = await supabase
    .from("tasks")
    .update({
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
    })
    .eq("id", input.id);

  if (error) throw error;
}
