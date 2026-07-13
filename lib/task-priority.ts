import type { ProcessedTask, TaskPriority } from "@/lib/types";

export const DEFAULT_TASK_PRIORITY: TaskPriority = "normal";

export const TASK_PRIORITY_OPTIONS: Array<{
  value: TaskPriority;
  label: string;
  description: string;
  badgeClassName: string;
  activeClassName: string;
}> = [
  {
    value: "alta",
    label: "Alta",
    description: "Mais urgente",
    badgeClassName: "border-red-200 bg-red-50 text-red-700",
    activeClassName: "border-red-500 bg-red-600 text-white shadow-sm",
  },
  {
    value: "normal",
    label: "Normal",
    description: "Padrao",
    badgeClassName: "border-blue-200 bg-blue-50 text-blue-700",
    activeClassName: "border-blue-500 bg-blue-600 text-white shadow-sm",
  },
  {
    value: "baixa",
    label: "Baixa",
    description: "Pode esperar",
    badgeClassName: "border-slate-200 bg-slate-50 text-slate-600",
    activeClassName: "border-slate-700 bg-slate-900 text-white shadow-sm",
  },
];

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  alta: 0,
  normal: 1,
  baixa: 2,
};

export function normalizeTaskPriority(value: unknown): TaskPriority {
  return value === "alta" || value === "baixa" || value === "normal" ? value : DEFAULT_TASK_PRIORITY;
}

export function taskPriorityLabel(priority: unknown) {
  return TASK_PRIORITY_OPTIONS.find((option) => option.value === normalizeTaskPriority(priority))?.label || "Normal";
}

export function taskPriorityBadgeClassName(priority: unknown) {
  return TASK_PRIORITY_OPTIONS.find((option) => option.value === normalizeTaskPriority(priority))?.badgeClassName || TASK_PRIORITY_OPTIONS[1].badgeClassName;
}

export function compareTaskPriority(left: Pick<ProcessedTask, "priority">, right: Pick<ProcessedTask, "priority">) {
  return PRIORITY_ORDER[normalizeTaskPriority(left.priority)] - PRIORITY_ORDER[normalizeTaskPriority(right.priority)];
}
