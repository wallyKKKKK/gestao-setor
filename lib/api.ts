import { supabase } from "@/lib/supabase";
import type { Announcement, Profile, Subtask, Task, TaskHistory, UserRole } from "@/lib/types";

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
}

export async function fetchProfiles() {
  const { data, error } = await supabase.from("profiles").select("*");
  if (error) throw error;
  return (data || []) as Profile[];
}

export async function fetchCurrentProfile(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("role, full_name, sector")
    .eq("id", userId)
    .single();

  if (error) throw error;
  return data as Pick<Profile, "role" | "full_name" | "sector">;
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

export async function fetchAnnouncements() {
  const { data, error } = await supabase
    .from("announcements")
    .select("*, profiles(full_name)")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []) as Announcement[];
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
  }]);

  if (error) throw error;
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
    })
    .eq("id", input.id);

  if (error) throw error;
}
