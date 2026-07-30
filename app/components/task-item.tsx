"use client";

import { memo, useRef, useState } from "react";
import type { PointerEvent, WheelEvent } from "react";
import { Check, ChevronDown, Edit3, Flag, MessageSquare, PauseCircle, Play, RotateCcw, Trash2 } from "lucide-react";
import { addAuditLog, addTaskHistory, updateTaskCompletion, updateTaskSubtasks } from "@/lib/api";
import { MARGIN_FLOW_CATEGORY, formatMarginPercent, parseMarginFlowTaskNotes } from "@/lib/margin-flow-task";
import { getPermissionDeniedMessage } from "@/lib/permissions";
import { taskPriorityBadgeClassName, taskPriorityLabel } from "@/lib/task-priority";
import { formatToBR, getScheduleDisplayLabel, getTodayStr } from "@/lib/task-recurrence";
import type { Profile, Subtask, TaskItemProps, TaskWorkflowStatus } from "@/lib/types";

export const TaskItem = memo(({ task, profiles, hasTradeNotes, onUpdate, onEdit, userRole, currentUser, onView, onToggle, onDelete, canDelete, onScheduleOverride, onWorkflowChange }: TaskItemProps) => {
  const [expanded, setExpanded] = useState(false);
  const [feedbackOffset, setFeedbackOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [optimisticSubtasks, setOptimisticSubtasks] = useState<Subtask[] | null>(null);
  const dragStartX = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef(0);
  const wheelOffset = useRef(0);
  const wheelCommitTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextClick = useRef(false);
  const isOwner = task.assigned_to === currentUser?.id;
  const canManage = userRole === "admin" || userRole === "gerente" || isOwner;
  const subtasks = optimisticSubtasks ?? task.subtasks ?? [];
  const subDone = subtasks.filter((s: Subtask) => s.done).length;
  const subTotal = subtasks.length;
  const subtaskProgressPercent = subTotal > 0 ? Math.round((subDone / subTotal) * 100) : 0;
  const isLate = task.lastOcc < getTodayStr() && !task.isDoneToday && task.lastOcc !== "1970-01-01";
  const isAdvanced = task.schedule_override_type === "advanced";
  const isPostponed = task.schedule_override_type === "postponed";
  const hasScheduleOverride = isAdvanced || isPostponed;
  const isScheduledToday = task.lastOcc === getTodayStr();
  const assignedProfile = profiles.find((p: Profile) => p.id === task.assigned_to);
  const assignedFirstName = assignedProfile?.full_name?.split(" ")[0] || "Sem dono";
  const assignedInitial = assignedProfile?.full_name?.charAt(0) || "?";
  const scheduleDisplayLabel = getScheduleDisplayLabel(task);
  const parsedMarginFlow = task.category === MARGIN_FLOW_CATEGORY
    ? parseMarginFlowTaskNotes(task.notes)
    : { data: null, cleanNotes: task.notes || "" };
  const marginFlowData = parsedMarginFlow.data;
  const displayNotes = parsedMarginFlow.cleanNotes;
  const scheduleLabel = isLate
    ? `DESDE ${formatToBR(task.lastOcc)}`
    : isAdvanced
      ? "ADIANTADA PARA HOJE"
      : isPostponed
        ? `ADIADA: ${task.nextOcc}`
        : isScheduledToday
          ? "HOJE"
          : scheduleDisplayLabel;
  const swipeDistance = 90;
  const dragAction = feedbackOffset <= -swipeDistance ? "advance" : feedbackOffset >= swipeDistance ? "postpone" : null;
  const manageTaskDeniedMessage = getPermissionDeniedMessage("alterar esta tarefa", "managerOrAdmin")
    + " O responsavel pela tarefa tambem pode concluir ou editar checklist.";
  const deleteTaskDeniedMessage = getPermissionDeniedMessage("excluir tarefas", "managerOrAdmin");
  const workflowStatus: TaskWorkflowStatus = task.isDoneToday ? "concluida" : task.workflow_status || "pendente";
  const isInProgress = workflowStatus === "em_andamento";
  const workflowStartedProfile = task.workflow_started_by ? profiles.find((p: Profile) => p.id === task.workflow_started_by) : null;
  const workflowName = task.workflow_started_by_name || workflowStartedProfile?.full_name || "";
  const workflowFirstName = workflowName.split(" ")[0] || assignedFirstName;
  const canPauseWorkflow = !isInProgress || !task.workflow_started_by || task.workflow_started_by === currentUser?.id;
  const pauseDeniedMessage = `Somente ${workflowFirstName} pode pausar esta tarefa.`;
  const workflowBadgeClassName = workflowStatus === "em_andamento"
    ? "border-blue-600 bg-blue-600 text-white shadow-[0_8px_18px_rgba(37,99,235,0.20)]"
    : workflowStatus === "bloqueada"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : workflowStatus === "concluida"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-slate-200 bg-white text-slate-600";
  const workflowLabel = workflowStatus === "em_andamento"
    ? `Em andamento por ${workflowFirstName}`
    : workflowStatus === "bloqueada"
      ? "Bloqueada"
      : workflowStatus === "concluida"
        ? "Concluida"
        : "Pendente";

  const changeWorkflow = (status: TaskWorkflowStatus) => {
    if (!canManage) {
      void recordBlockedTaskAttempt("Alterar status da tarefa");
      alert(manageTaskDeniedMessage);
      return;
    }

    if (status === "pendente" && isInProgress && !canPauseWorkflow) {
      void recordBlockedTaskAttempt("Pausar tarefa iniciada por outro usuario");
      alert(pauseDeniedMessage);
      return;
    }

    let blockedReason: string | null = null;
    if (status === "bloqueada") {
      const reason = window.prompt("Qual o motivo do bloqueio?", task.workflow_blocked_reason || "");
      if (reason === null) return;
      blockedReason = reason.trim() || null;
    }

    onWorkflowChange(task, status, blockedReason);
  };

  const recordBlockedTaskAttempt = async (action: string) => {
    if (!currentUser) return;
    const profile = profiles.find((item: Profile) => item.id === currentUser.id);
    await addAuditLog({
      actorId: currentUser.id,
      actorName: profile?.full_name || currentUser.email || "Usuario",
      action: "permission_blocked",
      entityType: "task",
      entityId: task.id,
      entityTitle: task.title,
      sector: task.sector,
      details: `${action}. ${manageTaskDeniedMessage}`,
    }).catch((error) => console.error("Erro ao registrar bloqueio de permissao:", error));
  };

  const setVisualOffset = (offset: number) => {
    offsetRef.current = offset;
    if (cardRef.current) {
      cardRef.current.style.transform = `translate3d(${offset}px, 0, 0)`;
    }
  };

  const resetVisualOffset = () => {
    offsetRef.current = 0;
    if (cardRef.current) {
      cardRef.current.style.transform = "";
    }
  };

  const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!canManage || task.isDoneToday) return;
    const target = event.target as HTMLElement;
    if (target.closest("button,input,textarea,select,a")) return;

    dragStartX.current = event.clientX;
    suppressNextClick.current = false;
    setIsDragging(true);
    setFeedbackOffset(0);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null) return;
    const offset = Math.max(-140, Math.min(140, event.clientX - dragStartX.current));
    if (Math.abs(offset) > 8) suppressNextClick.current = true;
    setVisualOffset(offset);
    if (
      Math.abs(offset) <= 8 ||
      Math.abs(offsetRef.current - feedbackOffset) > 28 ||
      (offset <= -swipeDistance && feedbackOffset > -swipeDistance) ||
      (offset >= swipeDistance && feedbackOffset < swipeDistance)
    ) {
      setFeedbackOffset(offset);
    }
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null) return;
    const currentOffset = offsetRef.current;
    const action = currentOffset <= -swipeDistance ? "advance" : currentOffset >= swipeDistance ? "postpone" : null;

    dragStartX.current = null;
    setIsDragging(false);
    setFeedbackOffset(0);
    resetVisualOffset();
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (action) onScheduleOverride(task, action);
  };

  const cancelDrag = () => {
    dragStartX.current = null;
    setIsDragging(false);
    setFeedbackOffset(0);
    resetVisualOffset();
  };

  const commitWheelDrag = () => {
    const action = wheelOffset.current <= -swipeDistance ? "advance" : wheelOffset.current >= swipeDistance ? "postpone" : null;
    wheelOffset.current = 0;
    setIsDragging(false);
    setFeedbackOffset(0);
    resetVisualOffset();

    if (action) onScheduleOverride(task, action);
  };

  const handleWheelDrag = (event: WheelEvent<HTMLDivElement>) => {
    if (!canManage || task.isDoneToday) return;
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;

    event.preventDefault();
    const nextOffset = Math.max(-140, Math.min(140, wheelOffset.current - event.deltaX));
    wheelOffset.current = nextOffset;
    suppressNextClick.current = true;
    setIsDragging(true);
    setFeedbackOffset(nextOffset);
    setVisualOffset(nextOffset);

    if (wheelCommitTimeout.current) clearTimeout(wheelCommitTimeout.current);
    wheelCommitTimeout.current = setTimeout(commitWheelDrag, 180);
  };

  const viewTask = (event?: PointerEvent<HTMLDivElement>) => {
    event?.stopPropagation();
    suppressNextClick.current = false;
    onView(task);
  };

  const toggleSubtask = async (index: number) => {
    if (!canManage) {
      await recordBlockedTaskAttempt("Alterar checklist");
      return alert(manageTaskDeniedMessage);
    }
    const newSubtasks = subtasks.map((subtask, subtaskIndex) => (
      subtaskIndex === index ? { ...subtask, done: !subtask.done } : { ...subtask }
    ));
    const allDone = newSubtasks.length > 0 && newSubtasks.every((s: Subtask) => s.done);
    const todayStr = getTodayStr();

    setOptimisticSubtasks(newSubtasks);

    try {
      if (allDone && !task.isDoneToday) {
        if (!currentUser) {
          setOptimisticSubtasks(null);
          return alert("Acao bloqueada: usuario nao identificado. Entre novamente no sistema.");
        }
        const profile = profiles.find((p: Profile) => p.id === currentUser?.id);
        void addTaskHistory({
          taskId: task.id,
          taskTitle: task.title,
          userName: profile?.full_name || currentUser?.email || "Usuario",
          userId: currentUser.id,
          category: task.category,
          sector: task.sector,
        }).catch((error) => console.error("Erro ao registrar historico da tarefa:", error));
      }

      if (allDone || task.isDoneToday) {
        await updateTaskCompletion(task.id, allDone ? todayStr : null, newSubtasks, Boolean(task.is_one_off && allDone));
      } else {
        await updateTaskSubtasks(task.id, newSubtasks);
      }

      if (currentUser) {
        const profile = profiles.find((p: Profile) => p.id === currentUser.id);
        void addAuditLog({
          actorId: currentUser.id,
          actorName: profile?.full_name || currentUser.email || "Usuario",
          action: allDone ? "task_completed" : "subtask_updated",
          entityType: "task",
          entityId: task.id,
          entityTitle: task.title,
          sector: task.sector,
          details: `Checklist: ${newSubtasks.filter((sub: Subtask) => sub.done).length}/${newSubtasks.length}`,
        }).catch((error) => console.error("Erro ao registrar auditoria:", error));
      }

      onUpdate();
    } catch (error) {
      setOptimisticSubtasks(null);
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      alert(`Erro ao atualizar subtarefa: ${message}`);
    }
  };

  return (
    <div className="relative mb-2">
      {isDragging && Math.abs(feedbackOffset) > 8 && (
        <div className={`pointer-events-none absolute inset-0 z-0 rounded-[24px] border-[3px] ${
          feedbackOffset < 0 ? "border-blue-300 bg-blue-100" : "border-slate-300 bg-slate-100"
        }`}>
          <div
            style={{ width: `${Math.max(72, Math.min(170, Math.abs(feedbackOffset)))}px` }}
            className={`absolute inset-y-0 flex items-center justify-center px-2 ${
              feedbackOffset < 0 ? "right-0 text-blue-700" : "left-0 text-[#232D4A]"
            }`}
          >
            <span className="rounded-full bg-white/80 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest shadow-sm">
              {feedbackOffset < 0 ? "Adiantar" : "Adiar"}
            </span>
          </div>
        </div>
      )}

      <div
        ref={cardRef}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={cancelDrag}
        onWheel={handleWheelDrag}
        className={`relative z-10 flex flex-col overflow-hidden border-[3px] rounded-[24px] group touch-pan-y
        will-change-transform
        ${isDragging ? "transition-none cursor-grabbing" : "transition-all duration-200"}
        ${dragAction === "advance" ? "ring-4 ring-blue-300" : dragAction === "postpone" ? "ring-4 ring-slate-300" : ""}
        ${task.isDoneToday ? "bg-green-400 border-green-200 opacity-80" :
          isInProgress ? "bg-blue-50 border-blue-500 shadow-[4px_4px_0px_0px_rgba(37,99,235,0.55),0_0_0_4px_rgba(37,99,235,0.08)] animate-[pulse_3.2s_ease-in-out_infinite]" :
          isLate ? "bg-red-400 border-red-200 shadow-[4px_4px_0px_0px_rgba(220,38,38,1)]" :
          isAdvanced ? "bg-blue-50 border-blue-500 shadow-[4px_4px_0px_0px_rgba(37,99,235,1)]" :
          isPostponed ? "bg-slate-50 border-[#232D4A] shadow-[4px_4px_0px_0px_rgba(35,45,74,1)]" :
          "bg-white border-slate-100 hover:border-slate-900 hover:shadow-[6px_6px_0px_0px_rgba(15,23,42,1)]"
        }`}
      >
      {subTotal > 0 && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 left-0 z-0 transition-all duration-500 ease-out ${
            task.isDoneToday ? "bg-green-500/35" : "bg-emerald-300/35"
          }`}
          style={{ width: `${subtaskProgressPercent}%` }}
        />
      )}
      {hasTradeNotes && task.category === "Trade" && (
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onView(task);
          }}
          className="absolute -right-3 -top-3 z-20 flex h-9 min-w-9 items-center justify-center gap-1 rounded-full border-2 border-white bg-blue-600 px-2.5 text-white shadow-[0_6px_14px_rgba(37,99,235,0.35)]"
          title="Tem notas de Trade"
          aria-label="Abrir notas de Trade"
        >
          <MessageSquare size={15} strokeWidth={3} />
          <span className="hidden sm:inline text-[8px] font-black uppercase tracking-widest">Nota</span>
        </button>
      )}
      <div className="relative z-10 flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-6 p-3 sm:p-4 md:px-8">
        <div className="flex shrink-0 flex-col items-center justify-center gap-2 self-stretch sm:w-[82px]">
          <button
            type="button"
            aria-disabled={!canManage}
            title={canManage ? (task.isDoneToday ? "Reabrir tarefa" : "Concluir tarefa") : manageTaskDeniedMessage}
            onClick={() => {
              if (canManage) {
                onToggle(task);
                return;
              }
              void recordBlockedTaskAttempt("Concluir tarefa");
              alert(manageTaskDeniedMessage);
            }}
            className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full border-4 flex items-center justify-center transition-all ${canManage ? "" : "cursor-not-allowed opacity-50"}
              ${task.isDoneToday ? "bg-green-600 border-green-700 text-white" : "bg-white border-slate-200 text-transparent hover:border-blue-500"}`}
          >
            <Check size={22} className="sm:w-[26px] sm:h-[26px]" strokeWidth={4} />
          </button>

        </div>

        <div className="flex-1 min-w-[180px] flex flex-col justify-center">
          <div
            role="button"
            tabIndex={0}
            className="cursor-pointer select-none group/title"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => viewTask()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onView(task);
              }
            }}
          >
            <h3 className={`text-base sm:text-lg font-black uppercase tracking-tight leading-tight sm:leading-none transition-colors
              ${task.isDoneToday ? "line-through text-green-900/40" : "text-slate-900 group-hover:text-blue-600"}`}
            >
              {task.title}
            </h3>
            <p className={`text-[10px] font-bold text-slate-400 italic line-clamp-1 mt-1 max-w-[720px] min-h-[14px]
              ${task.isDoneToday ? "text-green-700/30" : ""}
              ${displayNotes ? "" : "invisible"}`}
            >
              {displayNotes || "Sem descrição"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className="inline-flex h-7 max-w-[150px] items-center gap-1.5 rounded-full border border-slate-200 bg-white px-1.5 pr-3 text-[8px] font-black uppercase tracking-wide text-slate-800 shadow-sm">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[8px] font-black text-white">
                {assignedInitial}
              </span>
              <span className="truncate">{assignedFirstName}</span>
            </span>
            <span className="inline-flex h-6 items-center rounded-full border border-blue-200 bg-blue-50 px-3 text-[8px] font-black uppercase tracking-wide text-blue-700 shadow-sm">
              {task.category}
            </span>
            <span className={`inline-flex h-6 items-center gap-1 rounded-full border px-3 text-[8px] font-black uppercase tracking-wide shadow-sm ${taskPriorityBadgeClassName(task.priority)}`}>
              <Flag size={11} strokeWidth={3} />
              {taskPriorityLabel(task.priority)}
            </span>
            <span
              title={task.workflow_blocked_reason || workflowLabel}
              className={`inline-flex h-6 max-w-[210px] items-center rounded-full border px-3 text-[8px] font-black uppercase tracking-wide shadow-sm ${workflowBadgeClassName}`}
            >
              <span className="truncate">{workflowLabel}</span>
            </span>
            {marginFlowData && (
              <>
                <span className="inline-flex h-6 max-w-[240px] items-center rounded-full border border-slate-200 bg-white px-3 text-[8px] font-black uppercase tracking-wide text-slate-700 shadow-sm">
                  <span className="truncate">{marginFlowData.category}</span>
                </span>
                <span className="inline-flex h-6 items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 text-[8px] font-black uppercase tracking-wide text-emerald-700 shadow-sm">
                  Margem: {formatMarginPercent(marginFlowData.marginPercent)}
                </span>
                <span className="inline-flex h-6 items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 text-[8px] font-black uppercase tracking-wide text-indigo-700 shadow-sm">
                  Markup: {formatMarginPercent(marginFlowData.markupPercent)}
                </span>
              </>
            )}
            {hasScheduleOverride && (
              <span className={`inline-flex h-6 items-center rounded-full px-3 text-[8px] font-black uppercase tracking-wide border shadow-sm ${
                isAdvanced ? "bg-blue-600 border-blue-700 text-white" : "bg-[#232D4A] border-slate-900 text-white"
              }`}>
                {isAdvanced ? "ADIANTADA" : "ADIADA"}
              </span>
            )}
            <span
              title={scheduleLabel}
              className={`inline-flex h-6 max-w-[220px] items-center rounded-full px-3 text-[8px] font-black uppercase tracking-wide border shadow-sm
              ${task.isDoneToday ? "bg-green-100 border-green-200 text-green-700" :
                isLate ? "bg-red-600 border-red-700 text-white animate-pulse" : "bg-slate-100 border-slate-200 text-slate-700"}`}
            >
              <span className="truncate">{scheduleLabel}</span>
            </span>
          </div>
        </div>

        <div className="w-full sm:w-auto flex-shrink-0 flex items-center justify-end gap-3">
          {subTotal > 0 && (
            <button
              type="button"
              className={`flex items-center gap-3 px-4 py-2 rounded-2xl border-2 transition-all cursor-pointer
                ${expanded ? "bg-blue-600 border-blue-700 text-white shadow-[0_8px_18px_rgba(37,99,235,0.22)]" : "bg-blue-50 border-blue-100 text-blue-700 hover:border-blue-300 hover:bg-white"}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setExpanded((current) => !current);
              }}
              aria-expanded={expanded}
              aria-label={`${expanded ? "Ocultar" : "Mostrar"} subtarefas`}
            >
              <div className="flex items-center gap-2">
                <div className={`w-12 sm:w-16 h-1.5 rounded-full overflow-hidden ${expanded ? "bg-white/25" : "bg-blue-100"}`}>
                  <div className={`${expanded ? "bg-white" : "bg-blue-500"} h-full transition-all duration-500`} style={{ width: `${(subDone / subTotal) * 100}%` }} />
                </div>
                <span className="text-[10px] font-black whitespace-nowrap">{subDone}/{subTotal}</span>
              </div>
              <ChevronDown size={18} className={`transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>

        <div className="flex flex-col items-center gap-2 border-l-2 border-slate-100 pl-3 opacity-100 transition-opacity sm:pl-4 sm:opacity-0 group-hover:opacity-100">
          <div className="flex items-center gap-1">
            {hasScheduleOverride && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!canManage) {
                    void recordBlockedTaskAttempt("Restaurar agenda original");
                    alert(manageTaskDeniedMessage);
                    return;
                  }
                  onScheduleOverride(task, "clear");
                }}
                className={`p-2 transition-all ${canManage ? "text-slate-300 hover:text-slate-900" : "cursor-not-allowed text-slate-200 opacity-50"}`}
                title={canManage ? "Restaurar agenda original" : manageTaskDeniedMessage}
                aria-label="Restaurar agenda original"
                aria-disabled={!canManage}
              >
                <RotateCcw size={18}/>
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (!canManage) {
                  void recordBlockedTaskAttempt("Editar tarefa");
                  alert(manageTaskDeniedMessage);
                  return;
                }
                onEdit(task);
              }}
              className={`p-2 transition-all ${canManage ? "text-slate-300 hover:text-blue-600" : "cursor-not-allowed text-slate-200 opacity-50"}`}
              title={canManage ? "Editar tarefa" : manageTaskDeniedMessage}
              aria-disabled={!canManage}
            >
              <Edit3 size={20}/>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (!canDelete) {
                  void recordBlockedTaskAttempt("Excluir tarefa");
                  alert(deleteTaskDeniedMessage);
                  return;
                }
                onDelete(task.id);
              }}
              className={`p-2 transition-all ${canDelete ? "text-slate-200 hover:text-red-600" : "cursor-not-allowed text-slate-200 opacity-50"}`}
              title={canDelete ? "Excluir tarefa" : deleteTaskDeniedMessage}
              aria-disabled={!canDelete}
            >
              <Trash2 size={20}/>
            </button>
          </div>
          {canManage && !task.isDoneToday && (
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                changeWorkflow(workflowStatus === "em_andamento" ? "pendente" : "em_andamento");
              }}
              className={`inline-flex items-center justify-center gap-1 text-[9px] font-black uppercase tracking-widest transition ${workflowStatus === "em_andamento" && !canPauseWorkflow ? "cursor-not-allowed text-slate-200 hover:text-slate-300" : "text-slate-300 hover:text-blue-600"}`}
              title={workflowStatus === "em_andamento" ? (canPauseWorkflow ? "Pausar andamento" : pauseDeniedMessage) : "Marcar em andamento"}
            >
              {workflowStatus === "em_andamento" ? <PauseCircle size={12} strokeWidth={3} /> : <Play size={12} strokeWidth={3} />}
              {workflowStatus === "em_andamento" ? "Pausar" : "Iniciar"}
            </button>
          )}
        </div>
      </div>

      {expanded && subTotal > 0 && (
        <div className="relative z-10 px-4 sm:px-10 pb-6 space-y-2 animate-in slide-in-from-top-3 duration-300">
          <div className="h-[2px] bg-slate-100 mb-4 w-full" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {subtasks.map((sub: Subtask, index: number) => (
              <div
                key={index}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  void toggleSubtask(index);
                }}
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
    </div>
  );
});

TaskItem.displayName = "TaskItem";


