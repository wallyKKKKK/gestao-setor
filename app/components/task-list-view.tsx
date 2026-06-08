'use client';

import type { User as SupabaseUser } from '@supabase/supabase-js';
import { TaskItem } from '@/app/components/task-item';
import type { ProcessedTask, Profile, UserRole } from '@/lib/types';

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
  return (
    <div className="mx-auto max-w-[900px] space-y-5 pt-12">
      {tasks.map((task) => (
        <TaskItem
          key={task.id}
          task={task}
          profiles={profiles}
          hasTradeNotes={tradeNoteTaskIds.includes(String(task.id))}
          userRole={userRole}
          currentUser={currentUser}
          onToggle={onToggle}
          onView={onView}
          onEdit={onEdit}
          onUpdate={onUpdate}
          onDelete={onDelete}
          canDelete={canDeleteTasks}
          onScheduleOverride={onScheduleOverride}
        />
      ))}
    </div>
  );
}
