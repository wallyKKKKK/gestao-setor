"use client";

import { memo, useState } from "react";
import { Check, ChevronDown, Edit3, Trash2, User } from "lucide-react";
import { addTaskHistory, updateTaskCompletion } from "@/lib/api";
import { formatToBR, getTodayStr } from "@/lib/task-recurrence";
import type { Profile, Subtask, TaskItemProps } from "@/lib/types";

export const TaskItem = memo(({ task, profiles, onUpdate, onEdit, userRole, currentUser, onView, onToggle, onDelete }: TaskItemProps) => {
  const [expanded, setExpanded] = useState(false);
  const isOwner = task.assigned_to === currentUser?.id;
  const canManage = userRole === "admin" || userRole === "gerente" || isOwner;
  const subtasks = task.subtasks || [];
  const subDone = subtasks.filter((s: Subtask) => s.done).length;
  const subTotal = subtasks.length;
  const isLate = task.lastOcc < getTodayStr() && !task.isDoneToday && task.lastOcc !== "1970-01-01";

  const toggleSubtask = async (index: number) => {
    if (!canManage) return alert("Acesso negado.");
    const newSubtasks = [...subtasks];
    newSubtasks[index].done = !newSubtasks[index].done;
    const allDone = newSubtasks.length > 0 && newSubtasks.every((s: Subtask) => s.done);
    const todayStr = getTodayStr();

    if (allDone && !task.isDoneToday) {
      if (!currentUser) return alert("Acesso negado.");
      const profile = profiles.find((p: Profile) => p.id === currentUser?.id);
      await addTaskHistory({
        taskId: task.id,
        taskTitle: task.title,
        userName: profile?.full_name || currentUser?.email || "Usuário",
        userId: currentUser.id,
        category: task.category,
        sector: task.sector,
      });
    }

    await updateTaskCompletion(task.id, allDone ? todayStr : null, newSubtasks);
    onUpdate();
  };

  return (
    <div className={`relative flex flex-col transition-all duration-200 border-[3px] rounded-[24px] mb-2 group
      ${task.isDoneToday ? "bg-green-400 border-green-200 opacity-80" :
        isLate ? "bg-red-400 border-red-200 shadow-[4px_4px_0px_0px_rgba(220,38,38,1)]" :
        "bg-white border-slate-100 hover:border-slate-900 hover:shadow-[6px_6px_0px_0px_rgba(15,23,42,1)]"
      }`}
    >
      <div className="flex items-center gap-6 p-4 md:px-8">
        <div className="flex-shrink-0">
          <button
            onClick={() => canManage ? onToggle(task) : alert("Acesso negado.")}
            className={`w-12 h-12 rounded-full border-4 flex items-center justify-center transition-all
              ${task.isDoneToday ? "bg-green-600 border-green-700 text-white" : "bg-white border-slate-200 text-transparent hover:border-blue-500"}`}
          >
            <Check size={26} strokeWidth={4} />
          </button>
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="cursor-pointer select-none group/title" onClick={() => onView(task)}>
            <h3 className={`text-lg font-black uppercase tracking-tight leading-none transition-colors
              ${task.isDoneToday ? "line-through text-green-900/40" : "text-slate-900 group-hover:text-blue-600"}`}
            >
              {task.title}
            </h3>
            {task.notes && (
              <p className={`text-[10px] font-bold text-slate-400 italic line-clamp-1 mt-1 max-w-[400px]
                ${task.isDoneToday ? "text-green-700/30" : ""}`}
              >
                {task.notes}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 mt-2">
            <span className="px-2.5 py-1 rounded-lg bg-[#232D4A] text-white text-[8px] font-black uppercase flex items-center gap-1.5 shadow-sm">
              <User size={10}/> {profiles.find((p: Profile) => p.id === task.assigned_to)?.full_name?.split(" ")[0]}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 text-[8px] font-black uppercase shadow-sm">
              {task.category}
            </span>
            <span className={`px-2.5 py-1 rounded-lg text-[8px] font-black uppercase border shadow-sm
              ${task.isDoneToday ? "bg-green-100 border-green-200 text-green-700" :
                isLate ? "bg-red-600 border-red-700 text-white animate-pulse" : "bg-slate-50 border-slate-200 text-slate-500"}`}
            >
              {isLate ? `DESDE ${formatToBR(task.lastOcc)}` : `PRÓXIMA: ${task.nextOcc}`}
            </span>
          </div>
        </div>

        <div className="flex-shrink-0 flex items-center gap-3">
          {subTotal > 0 && (
            <div
              className={`flex items-center gap-3 px-4 py-2 rounded-2xl border-2 transition-all cursor-pointer
                ${expanded ? "bg-[#232D4A] border-slate-900 text-white shadow-md" : "bg-slate-50 border-slate-100 text-slate-500 hover:border-blue-400 hover:text-blue-600"}`}
              onClick={() => setExpanded(!expanded)}
            >
              <div className="flex items-center gap-2">
                <div className={`w-16 h-1.5 rounded-full overflow-hidden ${expanded ? "bg-white/20" : "bg-slate-200"}`}>
                  <div className={`${expanded ? "bg-blue-400" : "bg-blue-600"} h-full transition-all duration-500`} style={{ width: `${(subDone / subTotal) * 100}%` }} />
                </div>
                <span className="text-[10px] font-black whitespace-nowrap">{subDone}/{subTotal}</span>
              </div>
              <ChevronDown size={18} className={`transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} />
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 border-l-2 pl-4 border-slate-100 opacity-0 group-hover:opacity-100 transition-opacity">
          {canManage && (
            <>
              <button onClick={(e) => { e.stopPropagation(); onEdit(task); }} className="p-2 text-slate-300 hover:text-blue-600 transition-all">
                <Edit3 size={20}/>
              </button>
              <button onClick={(e) => { e.stopPropagation(); onDelete(task.id); }} className="p-2 text-slate-200 hover:text-red-600 transition-all">
                <Trash2 size={20}/>
              </button>
            </>
          )}
        </div>
      </div>

      {expanded && subTotal > 0 && (
        <div className="px-10 pb-6 space-y-2 animate-in slide-in-from-top-3 duration-300">
          <div className="h-[2px] bg-slate-100 mb-4 w-full" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {subtasks.map((sub: Subtask, index: number) => (
              <div
                key={index}
                onClick={() => toggleSubtask(index)}
                className={`flex items-center gap-3 p-3 rounded-2xl border-2 transition-all cursor-pointer
                  ${sub.done ? "bg-green-50/50 border-green-200 text-green-700 opacity-60" : "bg-slate-50 border-slate-100 text-slate-700 hover:border-blue-400"}
                `}
              >
                <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all
                  ${sub.done ? "bg-green-500 border-green-500 text-white" : "bg-white border-slate-300"}`}
                >
                  {sub.done && <Check size={12} strokeWidth={4} />}
                </div>
                <span className={`text-[10px] font-black uppercase ${sub.done ? "line-through opacity-50" : ""}`}>{sub.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

TaskItem.displayName = "TaskItem";
