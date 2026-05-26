import {
  AlertCircle,
  Calendar,
  History,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  TrendingUp,
  User,
  Users,
} from "lucide-react";
import type { UserRole } from "@/lib/types";

export const WEEK_DAYS = [
  { id: "seg", label: "S" },
  { id: "ter", label: "T" },
  { id: "qua", label: "Q" },
  { id: "qui", label: "Q" },
  { id: "sex", label: "S" },
];

export const TASK_CATEGORIES = ["Trade", "Reunião", "Geral"];

export const USER_ROLES: UserRole[] = ["membro", "gerente", "admin"];

export const SECTORS = [
  "Geral",
  "Compras Perfumaria",
  "Compras Medicamentos",
  "Precificação",
  "Logística",
];

export const GLOBAL_MEMBER_TABS = ["Todas", "HOJE", "Trade", "Reunião", "ATRASADOS"];

export const NAV_CATEGORIES = [
  { id: "HOJE", label: "Hoje", icon: Calendar },
  { id: "ATRASADOS", label: "Atrasados", icon: AlertCircle },
  { id: "Minhas", label: "Minhas", icon: User },
  { id: "Todas", label: "Todas", icon: ListChecks },
  { id: "Trade", label: "Trade", icon: TrendingUp },
  { id: "Reunião", label: "Reunião", icon: Users },
  { id: "HISTÓRICO", label: "Histórico", icon: History },
  { id: "DASHBOARD", label: "Dashboard", icon: LayoutDashboard },
  { id: "COMUNICADOS", label: "Alertas", icon: Megaphone },
];
