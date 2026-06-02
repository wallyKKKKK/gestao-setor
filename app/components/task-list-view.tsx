'use client';

import type { User as SupabaseUser } from '@supabase/supabase-js';
import { ChevronRight } from 'lucide-react';
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
  onScheduleOverride,
}: TaskListViewProps) {
  return (
    <div className="space-y-6">
      <h2 className="font-black uppercase text-slate-400 text-[10px] tracking-[0.3em] px-2 flex items-center gap-2">
        <ChevronRight size={14} className="text-blue-600" /> {activeTab} • {tasks.length} TAREFAS
      </h2>

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
          onScheduleOverride={onScheduleOverride}
        />
      ))}
    </div>
  );
}
