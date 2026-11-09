import type { ProcessedTask } from './types';

export function getTaskCardTone(task: ProcessedTask, today: string) {
  if (!task.isDoneToday && task.lastOcc === today && task.previousIncompleteOccurrence) return 'previous';
  if (task.isDoneToday) return 'done';
  if (task.workflow_status === 'em_andamento') return 'progress';
  if (task.lastOcc < today && task.lastOcc !== '1970-01-01') return 'late';
  if (task.schedule_override_type === 'advanced') return 'advanced';
  if (task.schedule_override_type === 'postponed') return 'postponed';
  return 'default';
}

export type TaskCardTone = ReturnType<typeof getTaskCardTone>;

export const taskCardSurfaceClass = 'border-2 border-[var(--task-card-edge)] shadow-[var(--task-shadow-offset,4px)_var(--task-shadow-offset,4px)_0_var(--task-card-edge)]';
export const taskCompletedBackgroundClass = 'bg-green-400';

export const taskCardToneClasses: Record<TaskCardTone, string> = {
  previous: 'bg-amber-50 [--task-card-edge:var(--color-amber-400)]',
  done: `${taskCompletedBackgroundClass} [--task-card-edge:var(--color-green-700)]`,
  progress: 'task-in-progress [--task-card-edge:color-mix(in_srgb,var(--section-accent,#2563eb)_85%,white)]',
  late: 'bg-red-400 [--task-card-edge:var(--color-red-700)]',
  advanced: 'bg-orange-100 dark:bg-orange-950/70 [--task-card-edge:var(--color-orange-700)]',
  postponed: 'bg-slate-300 [--task-card-edge:var(--color-slate-700)]',
  default: 'bg-white [--task-card-edge:var(--color-slate-300)] dark:[--task-card-edge:var(--app-border)]',
};
