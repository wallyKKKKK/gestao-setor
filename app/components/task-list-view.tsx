'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { TaskItem } from '@/app/components/task-item';
import type { ProcessedTask, Profile, UserRole } from '@/lib/types';

interface ExitingTask {
  task: ProcessedTask;
  index: number;
  tab: string;
}

const TASK_EXIT_ANIMATION_MS = 520;
const EXIT_ANIMATION_TABS = new Set(['HOJE', 'ATRASADOS']);

interface TaskListViewProps {
  activeTab: string;
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
}

export function TaskListView({
  activeTab,
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

  return (
    <div className="mx-auto max-w-[900px] space-y-5 pt-12">
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
              onScheduleOverride={onScheduleOverride}
            />
          </div>
        );
      })}
    </div>
  );
}
