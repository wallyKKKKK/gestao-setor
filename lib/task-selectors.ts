import { GLOBAL_MEMBER_TABS } from "@/app/constants";
import { compareTaskPriority, normalizeTaskPriority } from "@/lib/task-priority";
import { formatToBR, getLastOccurrence, getNextOccurrence, getTodayStr } from "@/lib/task-recurrence";
import type { ProcessedTask, Task, UserRole } from "@/lib/types";

interface FilterTasksInput {
  tasks: ProcessedTask[];
  activeTab: string;
  filterUsers: string[];
  userRole: UserRole;
  userSector: string;
  userId?: string;
  searchTerm: string;
}

interface TaskStatsInput {
  tasks: ProcessedTask[];
  dashFilter: "HOJE" | "SEMANAL";
  filterUsers: string[];
  userRole: UserRole;
  userSector: string;
  userId?: string;
}

export interface SectorStat {
  sector: string;
  total: number;
  concluidas: number;
  pendentes: number;
  porcentagem: number;
}

function isActionableTask(task: ProcessedTask, today: string) {
  return task.lastOcc !== "1970-01-01" && task.lastOcc <= today;
}

function compareFlowTasks(left: ProcessedTask, right: ProcessedTask) {
  const doneOrder = Number(left.isDoneToday) - Number(right.isDoneToday);
  if (doneOrder !== 0) return doneOrder;

  const priorityOrder = compareTaskPriority(left, right);
  if (priorityOrder !== 0) return priorityOrder;

  const dateOrder = left.lastOcc.localeCompare(right.lastOcc);
  if (dateOrder !== 0) return dateOrder;

  return right.created_at.localeCompare(left.created_at) || left.title.localeCompare(right.title, "pt-BR");
}

export function processTasks(tasks: Task[]): ProcessedTask[] {
  const today = getTodayStr();

  return tasks.filter((task) => !task.archived_at).map((task) => {
    const baseLastOcc = getLastOccurrence(task);
    const baseNextOcc = getNextOccurrence(task);
    const hasActiveScheduleOverride = Boolean(task.schedule_override_date && task.schedule_override_date >= today);
    const lastOcc = hasActiveScheduleOverride ? task.schedule_override_date || baseLastOcc : baseLastOcc;
    const nextOcc = hasActiveScheduleOverride && task.schedule_override_date ? formatToBR(task.schedule_override_date) : baseNextOcc;
    const isDoneToday = task.last_done_date === today || Boolean(task.last_done_date && task.last_done_date >= lastOcc);
    const shouldResetSubtasks = Boolean(task.last_done_date && task.last_done_date < lastOcc && !isDoneToday);
    const subtasks = shouldResetSubtasks
      ? task.subtasks.map((subtask) => ({ ...subtask, done: false }))
      : task.subtasks;

    return {
      ...task,
      priority: normalizeTaskPriority(task.priority),
      subtasks,
      lastOcc,
      nextOcc,
      isDoneToday,
    };
  });
}

export function filterTasks({
  tasks,
  activeTab,
  filterUsers,
  userRole,
  userSector,
  userId,
  searchTerm,
}: FilterTasksInput): ProcessedTask[] {
  const normalizedSearch = searchTerm.toLowerCase();
  const today = getTodayStr();

  return tasks.filter((task) => {
    if (task.category === "Reunião") return false;

    const canSeeCrossSectorTrade =
      userSector === "Trade" &&
      activeTab === "Trade" &&
      task.category === "Trade";

    const isAssignedToCurrentUser = Boolean(userId && task.assigned_to === userId);

    if (userRole !== "admin" && task.sector !== userSector && !canSeeCrossSectorTrade && !isAssignedToCurrentUser) {
      return false;
    }

    const matchesSearch =
      task.title.toLowerCase().includes(normalizedSearch) ||
      Boolean(task.notes && task.notes.toLowerCase().includes(normalizedSearch));

    if (searchTerm && !matchesSearch) return false;
    if (userRole === "membro" && !GLOBAL_MEMBER_TABS.includes(activeTab) && task.assigned_to !== userId) return false;
    if (filterUsers.length > 0 && !filterUsers.includes(task.assigned_to)) return false;

    if (activeTab === "ATRASADOS") return !task.isDoneToday && task.lastOcc < today;
    if (activeTab === "HOJE") return task.lastOcc === today && !task.isDoneToday;
    if (activeTab === "Minhas") return task.assigned_to === userId;
    if (activeTab === "Todas") return true;

    return task.category === activeTab;
  }).sort(compareFlowTasks);
}

export function getTaskStats({ tasks, dashFilter, filterUsers, userRole, userSector, userId }: TaskStatsInput) {
  const today = getTodayStr();
  const taskOnlyItems = tasks.filter((task) => task.category !== "Reunião");
  const visibleTasks = userRole === "admin"
    ? taskOnlyItems
    : taskOnlyItems.filter((task) => task.sector === userSector || Boolean(userId && task.assigned_to === userId));
  const baseTasks = filterUsers.length === 0 ? visibleTasks : visibleTasks.filter((task) => filterUsers.includes(task.assigned_to));
  const periodTasks = dashFilter === "HOJE"
    ? baseTasks.filter((task) => task.lastOcc === today)
    : baseTasks.filter((task) => isActionableTask(task, today));
  const concluidas = periodTasks.filter((task) => task.isDoneToday).length;
  const total = periodTasks.length;
  const porcentagem = total > 0 ? Math.round((concluidas / total) * 100) : 0;

  return {
    total,
    concluidas,
    pendentes: total - concluidas,
    porcentagem,
  };
}

export function getSectorStats({
  tasks,
  dashFilter,
  userRole,
  userSector,
  userId,
}: Omit<TaskStatsInput, "filterUsers">): SectorStat[] {
  const today = getTodayStr();
  const taskOnlyItems = tasks.filter((task) => task.category !== "Reunião");
  const visibleTasks = userRole === "admin"
    ? taskOnlyItems
    : taskOnlyItems.filter((task) => task.sector === userSector || Boolean(userId && task.assigned_to === userId));
  const periodTasks = dashFilter === "HOJE"
    ? visibleTasks.filter((task) => task.lastOcc === today)
    : visibleTasks.filter((task) => isActionableTask(task, today));
  const sectors = Array.from(new Set(periodTasks.map((task) => task.sector || "Geral")));

  return sectors
    .map((sector) => {
      const sectorTasks = periodTasks.filter((task) => (task.sector || "Geral") === sector);
      const concluidas = sectorTasks.filter((task) => task.isDoneToday).length;
      const total = sectorTasks.length;

      return {
        sector,
        total,
        concluidas,
        pendentes: total - concluidas,
        porcentagem: total > 0 ? Math.round((concluidas / total) * 100) : 0,
      };
    })
    .sort((a, b) => b.porcentagem - a.porcentagem || b.total - a.total);
}
