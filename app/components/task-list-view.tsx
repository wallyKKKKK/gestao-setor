'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { TaskItem } from '@/app/components/task-item';
import { getTaskCardTone, taskCardSurfaceClass, taskCardToneClasses, type TaskCardTone } from '@/lib/task-card-tone';
import { getTodayStr } from '@/lib/task-recurrence';
import type { ProcessedTask, Profile, TaskWorkflowStatus, UserRole } from '@/lib/types';

interface ExitingTask {
  task: ProcessedTask;
  index: number;
  tab: string;
}

const TASK_EXIT_ANIMATION_MS = 520;
const EXIT_ANIMATION_TABS = new Set(['HOJE', 'ATRASADOS']);
const TASK_COLOR_MARKERS = [
  { tone: 'previous', label: 'Pendência anterior' },
  { tone: 'progress', label: 'Em andamento' },
  { tone: 'late', label: 'Atrasada' },
  { tone: 'done', label: 'Concluída' },
  { tone: 'advanced', label: 'Adiantada' },
  { tone: 'postponed', label: 'Adiada' },
  { tone: 'default', label: 'Sem destaque' },
] as const;

interface TaskListViewProps {
  activeTab: string;
  legendTarget: HTMLElement | null;
  tasks: ProcessedTask[];
  profiles: Profile[];
  tradeNoteTaskIds: string[];
  userRole: UserRole;
  currentUser: SupabaseUser | null;
  onToggle: (task: ProcessedTask) => void;
  onView: (task: ProcessedTask) => void;
  onEdit: (task: ProcessedTask) => void;
  onUpdate: () => void;
  onDelete: (taskId: string) => void;
  canDeleteTasks: boolean;
  onScheduleOverride: (task: ProcessedTask, action: 'advance' | 'postpone' | 'clear') => void;
  onWorkflowChange: (task: ProcessedTask, status: TaskWorkflowStatus, blockedReason?: string | null) => void;
}

export function TaskListView({
  activeTab,
  legendTarget,
  tasks,
  profiles,
  tradeNoteTaskIds,
  userRole,
  currentUser,
  onToggle,
  onView,
  onEdit,
  onUpdate,
  onDelete,
  canDeleteTasks,
  onScheduleOverride,
  onWorkflowChange,
}: TaskListViewProps) {
  const [exitingTasks, setExitingTasks] = useState<Record<string, ExitingTask>>({});
  const [hiddenCompletedTasks, setHiddenCompletedTasks] = useState<Record<string, { tab: string }>>({});
  const exitTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = exitTimersRef.current;

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const displayTasks = useMemo(() => {
    const visibleTasks = tasks.filter((task) => {
      const hiddenTask = hiddenCompletedTasks[task.id];
      return !(hiddenTask?.tab === activeTab && task.isDoneToday);
    });
    const currentIds = new Set(visibleTasks.map((task) => task.id));
    const orderedTasks = [...visibleTasks];
    const pendingExitTasks = Object.values(exitingTasks)
      .filter((item) => item.tab === activeTab && !currentIds.has(item.task.id))
      .sort((left, right) => left.index - right.index);

    pendingExitTasks.forEach((item) => {
      orderedTasks.splice(Math.min(item.index, orderedTasks.length), 0, item.task);
    });

    return orderedTasks;
  }, [activeTab, exitingTasks, hiddenCompletedTasks, tasks]);

  const startExitAnimation = (task: ProcessedTask) => {
    if (task.isDoneToday || !EXIT_ANIMATION_TABS.has(activeTab)) return;

    const taskIndex = Math.max(0, tasks.findIndex((item) => item.id === task.id));
    const tabAtStart = activeTab;
    setExitingTasks((current) => ({ ...current, [task.id]: { task, index: taskIndex, tab: tabAtStart } }));

    const currentTimer = exitTimersRef.current.get(task.id);
    if (currentTimer) clearTimeout(currentTimer);

    const timer = setTimeout(() => {
      setExitingTasks((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
      setHiddenCompletedTasks((current) => ({ ...current, [task.id]: { tab: tabAtStart } }));
      exitTimersRef.current.delete(task.id);
    }, TASK_EXIT_ANIMATION_MS);

    exitTimersRef.current.set(task.id, timer);
  };

  const handleToggle = (task: ProcessedTask) => {
    startExitAnimation(task);
    onToggle(task);
  };

  const today = getTodayStr();
  const counts = new Map<TaskCardTone, number>();
  for (const task of displayTasks) {
    const tone = getTaskCardTone(task, today);
    counts.set(tone, (counts.get(tone) ?? 0) + 1);
  }
  const legendItems = TASK_COLOR_MARKERS.flatMap((marker) => {
    const count = counts.get(marker.tone);
    return count ? [{ ...marker, count }] : [];
  });

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-5 px-2 pt-12 sm:px-[30px]">
      {legendTarget && legendItems.length > 0 && createPortal(
      <div role="group" aria-label="Legenda de cores das tarefas" className="overflow-x-auto border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="mx-auto flex w-max gap-2 pr-1 [--task-shadow-offset:2px]">
        {legendItems.map(({ tone, label, count }) => (
          <span key={tone} className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-[10px] font-black uppercase ${taskCardSurfaceClass} ${taskCardToneClasses[tone]} ${tone === 'late' || tone === 'done' ? 'text-slate-950' : 'text-slate-900'}`}>
            {label}<span aria-hidden="true">·</span><span className="tabular-nums">{count}</span>
          </span>
        ))}
        </div>
      </div>, legendTarget)}
      {displayTasks.map((task) => {
        const isExiting = exitingTasks[task.id]?.tab === activeTab;

        return (
          <div
            key={task.id}
            className={`transition-all duration-500 ease-out will-change-transform ${
              isExiting ? 'pointer-events-none -translate-y-3 scale-[0.98] opacity-0 blur-[1px]' : 'translate-y-0 scale-100 opacity-100 blur-0'
            }`}
          >
            <TaskItem
              task={task}
              profiles={profiles}
              hasTradeNotes={tradeNoteTaskIds.includes(String(task.id))}
              userRole={userRole}
              currentUser={currentUser}
              onToggle={handleToggle}
              onView={onView}
              onEdit={onEdit}
              onUpdate={onUpdate}
              onDelete={onDelete}
              canDelete={canDeleteTasks}
              allowAdvance={activeTab !== 'HOJE'}
              onScheduleOverride={onScheduleOverride}
              onWorkflowChange={onWorkflowChange}
            />
          </div>
        );
      })}
    </div>
  );
}
