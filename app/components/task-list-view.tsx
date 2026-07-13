'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { TaskItem } from '@/app/components/task-item';
import type { ProcessedTask, Profile, UserRole } from '@/lib/types';

interface ExitingTask {
  task: ProcessedTask;
  index: number;
}

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
  const exitTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = exitTimersRef.current;

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const displayTasks = useMemo(() => {
    const currentIds = new Set(tasks.map((task) => task.id));
    const orderedTasks = [...tasks];
    const pendingExitTasks = Object.values(exitingTasks)
      .filter((item) => !currentIds.has(item.task.id))
      .sort((left, right) => left.index - right.index);

    pendingExitTasks.forEach((item) => {
      orderedTasks.splice(Math.min(item.index, orderedTasks.length), 0, item.task);
    });

    return orderedTasks;
  }, [exitingTasks, tasks]);

  const startExitAnimation = (task: ProcessedTask) => {
    if (activeTab !== 'HOJE' || task.isDoneToday) return;

    const taskIndex = Math.max(0, tasks.findIndex((item) => item.id === task.id));
    setExitingTasks((current) => ({ ...current, [task.id]: { task, index: taskIndex } }));

    const currentTimer = exitTimersRef.current.get(task.id);
    if (currentTimer) clearTimeout(currentTimer);

    const timer = setTimeout(() => {
      setExitingTasks((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
      exitTimersRef.current.delete(task.id);
    }, 520);

    exitTimersRef.current.set(task.id, timer);
  };

  const handleToggle = (task: ProcessedTask) => {
    startExitAnimation(task);
    onToggle(task);
  };

  return (
    <div className="mx-auto max-w-[900px] space-y-5 pt-12">
      {displayTasks.map((task) => {
        const isExiting = Boolean(exitingTasks[task.id]);

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
