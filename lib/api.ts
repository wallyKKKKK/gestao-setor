import { supabase } from "@/lib/supabase";
import type { AccountStatus, Announcement, AuditLog, PricingBranch, PricingProduct, Profile, Subtask, SupplierPaymentTerm, Task, TaskHistory, UserRole } from "@/lib/types";

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

export type PricingProductInput = Omit<PricingProduct, "id" | "created_at" | "updated_at"> & {
  id?: string;
};

export type PricingBranchInput = Omit<PricingBranch, "id" | "created_at" | "updated_at"> & {
  id?: string;
};

export type SupplierPaymentTermInput = Omit<SupplierPaymentTerm, "id" | "created_at" | "updated_at"> & {
  id?: string;
};

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
  return (data || []) as Task[];
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
  }]);

  if (error) throw error;
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

export async function updateTaskCompletion(taskId: string, lastDoneDate: string | null, subtasks: Subtask[]) {
  const { error } = await supabase.from("tasks").update({
    last_done_date: lastDoneDate,
    status: lastDoneDate ? "concluido" : "pendente",
    subtasks,
  }).eq("id", taskId);

  if (error) throw error;
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
      ...(input.sector !== undefined ? { sector: input.sector } : {}),
      ...(input.googleEventId !== undefined ? { google_event_id: input.googleEventId } : {}),
      ...(input.googleEventLink !== undefined ? { google_event_link: input.googleEventLink } : {}),
    })
    .eq("id", input.id);

  if (error) throw error;
}
