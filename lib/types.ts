import type { User as SupabaseUser } from "@supabase/supabase-js";

export interface Subtask {
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  assigned_to: string;
  category: string;
  status: "pendente" | "concluido";
  last_done_date: string | null;
  repeat_days: string;
  repeat_interval: number;
  subtasks: Subtask[];
  created_at: string;
  sector: string;
  lastOcc?: string;
  nextOcc?: string;
  isDoneToday?: boolean;
}

export type ProcessedTask = Task & {
  lastOcc: string;
  nextOcc: string;
  isDoneToday: boolean;
};

export type UserRole = "admin" | "gerente" | "membro";

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  sector: string;
}

export interface TaskHistory {
  id: string;
  task_id: string;
  task_title: string;
  user_name: string;
  user_id: string;
  category: string;
  sector: string;
  created_at: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  created_by: string;
  sector: string;
  image_url: string | null;
  created_at: string;
  profiles?: {
    full_name: string | null;
  } | null;
}

export interface TaskItemProps {
  task: ProcessedTask;
  profiles: Profile[];
  onUpdate: () => void;
  onEdit: (task: ProcessedTask) => void;
  userRole: UserRole;
  currentUser: SupabaseUser | null;
  onView: (task: ProcessedTask) => void;
  onToggle: (task: ProcessedTask) => void;
  onDelete: (taskId: string) => void;
}
