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
  due_date: string | null;
  created_at: string;
  sector: string;
  google_event_id: string | null;
  google_event_link: string | null;
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
export type AccountStatus = "pending" | "approved" | "rejected";

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  sector: string;
  account_status?: AccountStatus;
  is_active?: boolean;
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

export interface AuditLog {
  id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_title: string | null;
  sector: string;
  details: string | null;
  created_at: string;
}

export type DiscountMode = "currency" | "percent";

export interface PricingProduct {
  id: string;
  ean: string;
  description: string;
  brand: string;
  purchase_price: number;
  sell_in_value: number;
  sell_in_mode: DiscountMode;
  sell_out_value: number;
  sell_out_mode: DiscountMode;
  trade_value: number;
  trade_mode: DiscountMode;
  sale_price: number;
  baby_wednesday_price: number;
  month_end_price: number;
  competitor_prices: Record<string, number>;
  store_prices: Record<string, number>;
  created_at?: string;
  updated_at?: string;
}

export interface PricingBranch {
  id: string;
  name: string;
  code: string;
  city: string;
  legal_name: string;
  uf: string;
  cnpj: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface SupplierPaymentTerm {
  id: string;
  supplier_name: string;
  payment_terms: string;
  category: string;
  region: string;
  min_order_value: number;
  condition_notes: string;
  contact_name: string;
  phone: string;
  email: string;
  tax_id: string;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
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
