"use client";

import type { RefObject } from "react";
import { Activity, Calendar, Check, ChevronDown, Flag, ListChecks, Plus, User, X } from "lucide-react";
import { TASK_CATEGORIES, WEEK_DAYS } from "@/app/constants";
import { MarginFlowTaskFields } from "@/app/components/margin-flow-task-fields";
import { buildMarginFlowTaskNotes, MARGIN_FLOW_CATEGORY, canUseMarginFlowTasks, marginFlowTaskTitle, parseMarginFlowTaskNotes } from "@/lib/margin-flow-task";
import { TASK_PRIORITY_OPTIONS } from "@/lib/task-priority";
import { buildMonthlyWeekdayRepeat, MONTHLY_WEEKDAY_ORDINALS, parseMonthlyWeekdayRepeats } from "@/lib/task-recurrence";
import type { PricingMarginRule, ProcessedTask, Profile, Subtask, UserRole } from "@/lib/types";

interface EditTaskModalProps {
  task: ProcessedTask;
  setTask: (task: ProcessedTask) => void;
  profiles: Profile[];
  userRole: UserRole;
  userSector: string;
  marginRules: PricingMarginRule[];
  editMode: "pontual" | "semanal" | "mensal";
  setEditMode: (mode: "pontual" | "semanal" | "mensal") => void;
  editDisplayDate: string;
  setEditDisplayDate: (date: string) => void;
  editDateInputRef: RefObject<HTMLInputElement | null>;
  showAssignMenu: boolean;
  setShowAssignMenu: (show: boolean) => void;
  showCategoryMenu: boolean;
  setShowCategoryMenu: (show: boolean) => void;
  onToggleDay: (day: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export function EditTaskModal({
  task,
  setTask,
  profiles,
  userRole,
  userSector,
  marginRules,
  editMode,
  setEditMode,
  editDisplayDate,
  setEditDisplayDate,
  editDateInputRef,
  showAssignMenu,
  setShowAssignMenu,
  showCategoryMenu,
  setShowCategoryMenu,
  onToggleDay,
  onClose,
  onSave,
}: EditTaskModalProps) {
  const monthlyWeekdayRepeats = parseMonthlyWeekdayRepeats(task.repeat_days);
  const isOneOff = editMode === "pontual";
  const isMonthlyWeekday = editMode === "mensal" && monthlyWeekdayRepeats.length > 0;
  const selectedMonthlyWeekdayValues = new Set(monthlyWeekdayRepeats.map((repeat) => repeat.value));
  const canUseMarginFlow = canUseMarginFlowTasks(userSector);
  const taskCategoryOptions = TASK_CATEGORIES.filter((option) => option !== MARGIN_FLOW_CATEGORY || canUseMarginFlow);
  const isMarginFlow = task.category === MARGIN_FLOW_CATEGORY;
  const showMarginFlowFields = isMarginFlow && canUseMarginFlow;
  const marginFlowNotes = parseMarginFlowTaskNotes(task.notes || "");
  const visibleNotes = isMarginFlow ? marginFlowNotes.cleanNotes : task.notes || "";
  const updateVisibleNotes = (value: string) => {
    setTask({
      ...task,
      notes: isMarginFlow ? buildMarginFlowTaskNotes(value, marginFlowNotes.data) : value,
    });
  };
  const toggleMonthlyWeekdayRepeat = (ordinal: (typeof MONTHLY_WEEKDAY_ORDINALS)[number]['value'], weekday: string) => {
    const value = buildMonthlyWeekdayRepeat(ordinal, weekday);
    const currentValues = parseMonthlyWeekdayRepeats(task.repeat_days).map((repeat) => repeat.value);
    const nextValues = currentValues.includes(value) ? currentValues.filter((item) => item !== value) : [...currentValues, value];
    setTask({ ...task, repeat_days: nextValues.join(',') });
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/16 p-3 backdrop-blur-sm animate-in zoom-in-95 duration-300">
      <div className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
        <div className="hidden absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-600 to-indigo-600"></div>

        <div className="shrink-0 flex items-center justify-between border-b-2 border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-xl font-black uppercase italic tracking-tighter text-slate-900 leading-none">Editar tarefa</h2>
            <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest mt-1">Ajuste de Coordenadas Operacionais</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 transition hover:bg-slate-200"
          >
            <X size={21} strokeWidth={3} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-4 no-scrollbar">
          <div className="grid gap-3 md:grid-cols-2">
            <input
              className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 text-sm font-black uppercase text-slate-900 outline-none transition focus:border-blue-600 md:col-span-2"
              value={task.title}
              onChange={e => setTask({ ...task, title: e.target.value })}
            />
            <textarea
              className="h-20 w-full resize-none rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none transition focus:border-blue-600 md:col-span-2"
              value={visibleNotes}
              onChange={e => updateVisibleNotes(e.target.value)}
            />
            {showMarginFlowFields && (
              <MarginFlowTaskFields
                notes={task.notes || ""}
                onNotesChange={(value) => setTask({ ...task, notes: value })}
                onSelectionChange={(data, nextNotes) => {
                  const nextTitle = marginFlowTaskTitle(data);
                  setTask({ ...task, notes: nextNotes, title: nextTitle || task.title });
                }}
                marginRules={marginRules}
              />
            )}
          </div>

          <div className="space-y-3 rounded-2xl border-2 border-slate-100 bg-slate-50 p-4">
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-2">
              <ListChecks size={14} className="text-blue-500"/> Checklist de Passos
            </label>
            <div className="grid grid-cols-1 gap-2">
              {(task.subtasks || []).map((sub: Subtask, index: number) => (
                <div key={index} className="flex items-center gap-2 bg-white p-2.5 rounded-xl border-2 border-slate-100 shadow-sm">
                  <input
                    type="checkbox"
                    checked={sub.done}
                    onChange={(e) => {
                      const newSubs = [...task.subtasks];
                      newSubs[index].done = e.target.checked;
                      setTask({ ...task, subtasks: newSubs });
                    }}
                    className="w-4 h-4 accent-blue-600 ml-2"
                  />
                  <input
                    className="flex-1 text-xs font-black text-slate-600 outline-none uppercase"
                    value={sub.title}
                    onChange={(e) => {
                      const newSubs = [...task.subtasks];
                      newSubs[index].title = e.target.value;
                      setTask({ ...task, subtasks: newSubs });
                    }}
                  />
                  <button
                    onClick={() => {
                      const newSubs = task.subtasks.filter((_: Subtask, i: number) => i !== index);
                      setTask({ ...task, subtasks: newSubs });
                    }}
                    className="text-red-400 p-1 hover:bg-red-50 rounded-lg"
                  >
                    <X size={14}/>
                  </button>
                </div>
              ))}
              <button
                onClick={() => {
                  const newSubs = [...(task.subtasks || []), { title: "", done: false }];
                  setTask({ ...task, subtasks: newSubs });
                }}
                className="flex items-center justify-center gap-2 p-2 border-2 border-dashed border-slate-300 rounded-xl text-slate-400 font-black text-[9px] hover:border-blue-400 transition-all uppercase"
              >
                <Plus size={14} strokeWidth={3}/> Adicionar Passo
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div className="space-y-3 bg-white p-4 rounded-[24px] border-2 border-slate-100 shadow-sm">
              <div className="flex bg-slate-100 p-1 rounded-xl border-2 border-slate-200">
                <button type="button" onClick={() => {
                  const dateValue = task.due_date || new Date().toISOString().slice(0, 10);
                  const [year, month, day] = dateValue.split("-");
                  setEditMode("pontual");
                  setEditDisplayDate(`${day}/${month}/${year}`);
                  setTask({ ...task, repeat_days: "", due_date: dateValue, is_one_off: true });
                }} className={`flex-1 py-1.5 rounded-lg font-black text-[10px] uppercase transition-all ${editMode === "pontual" ? "bg-white text-blue-600 shadow-sm" : "text-slate-400"}`}>Pontual</button>
                <button type="button" onClick={() => { setEditMode("semanal"); setTask({ ...task, repeat_days: "", due_date: null, is_one_off: false }); }} className={`flex-1 py-1.5 rounded-lg font-black text-[10px] uppercase transition-all ${editMode === "semanal" ? "bg-white text-blue-600 shadow-sm" : "text-slate-400"}`}>Semanal</button>
                <button type="button" onClick={() => { setEditMode("mensal"); setTask({ ...task, repeat_days: "1", due_date: null, is_one_off: false }); }} className={`flex-1 py-1.5 rounded-lg font-black text-[10px] uppercase transition-all ${editMode === "mensal" ? "bg-white text-blue-600 shadow-sm" : "text-slate-400"}`}>Mensal</button>
              </div>

              {isOneOff ? (
                <div className="space-y-2">
                  <label className="text-[9px] font-black uppercase text-slate-400 ml-2 italic">Data de execucao</label>
                  <div className="relative h-[50px] group cursor-pointer" onClick={() => editDateInputRef.current?.showPicker()}>
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-50 rounded-xl border-2 border-slate-100 font-black text-slate-700 text-base pointer-events-none uppercase transition-all group-hover:border-blue-500">
                      {editDisplayDate}
                      <Calendar size={16} className="absolute right-4 text-blue-500" />
                    </div>
                    <input
                      ref={editDateInputRef}
                      type="date"
                      value={task.due_date || ""}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      onChange={e => {
                        const dVal = e.target.value;
                        if (dVal) {
                          const [year, month, day] = dVal.split("-");
                          setEditDisplayDate(`${day}/${month}/${year}`);
                          setTask({ ...task, due_date: dVal, repeat_days: "", is_one_off: true });
                        }
                      }}
                    />
                  </div>
                </div>
              ) : editMode === "mensal" ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 rounded-xl border-2 border-slate-100 bg-slate-50 p-1">
                    <button type="button" onClick={() => setTask({ ...task, repeat_days: "1" })} className={`rounded-lg py-2 text-[9px] font-black uppercase transition ${!isMonthlyWeekday ? "bg-white text-blue-600 shadow-sm" : "text-slate-400"}`}>Dia fixo</button>
                    <button type="button" onClick={() => setTask({ ...task, repeat_days: buildMonthlyWeekdayRepeat("1", "seg") })} className={`rounded-lg py-2 text-[9px] font-black uppercase transition ${isMonthlyWeekday ? "bg-white text-blue-600 shadow-sm" : "text-slate-400"}`}>Dia da semana</button>
                  </div>

                  {!isMonthlyWeekday ? (
                    <>
                      <label className="text-[9px] font-black uppercase text-slate-400 ml-2 italic">Novo Dia</label>
                      <div className="relative h-[50px] group cursor-pointer" onClick={() => editDateInputRef.current?.showPicker()}>
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 rounded-xl border-2 border-slate-100 font-black text-slate-700 text-base pointer-events-none uppercase transition-all group-hover:border-blue-500">
                          {editDisplayDate}
                          <Calendar size={16} className="absolute right-4 text-blue-500" />
                        </div>
                        <input
                          ref={editDateInputRef}
                          type="date"
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          onChange={e => {
                            const dVal = e.target.value;
                            if (dVal) {
                              const [, , d] = dVal.split("-");
                              setEditDisplayDate(`${d}/${dVal.split("-")[1]}/${dVal.split("-")[0]}`);
                              setTask({ ...task, repeat_days: d });
                            }
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <p className="px-1 text-[8px] font-black uppercase tracking-widest text-slate-400">Marque uma ou mais semanas do mes</p>
                      <div className="grid grid-cols-[74px_repeat(5,minmax(0,1fr))] gap-1 rounded-2xl border-2 border-slate-100 bg-slate-50 p-2">
                        <span className="self-center text-[8px] font-black uppercase text-slate-400">Semana</span>
                        {WEEK_DAYS.map((day) => (
                          <span key={day.id} className="text-center text-[8px] font-black uppercase text-slate-400">{day.label}</span>
                        ))}
                        {MONTHLY_WEEKDAY_ORDINALS.map((item) => (
                          <div key={item.value} className="contents">
                            <span className="flex items-center text-[8px] font-black uppercase text-slate-500">{item.label}</span>
                            {WEEK_DAYS.map((day) => {
                              const value = buildMonthlyWeekdayRepeat(item.value, day.id);
                              const selected = selectedMonthlyWeekdayValues.has(value);
                              return (
                                <button key={value} type="button" onClick={() => toggleMonthlyWeekdayRepeat(item.value, day.id)} className={`h-8 rounded-xl text-[9px] font-black uppercase transition ${selected ? "bg-blue-600 text-white shadow-sm" : "bg-white text-slate-400 hover:text-blue-600"}`}>
                                  {day.label}
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex gap-1.5 justify-center p-1.5 bg-slate-50 rounded-xl border-2 border-slate-100">
                  {WEEK_DAYS.map(day => (
                    <button key={day.id} type="button" onClick={() => onToggleDay(day.id)} className={`w-8 h-8 rounded-lg font-black text-[10px] transition-all ${task.repeat_days?.split(",").includes(day.id) ? "bg-blue-600 text-white shadow-lg" : "bg-white text-slate-300"}`}>{day.label}</button>
                  ))}
                </div>
              )}
              {!isOneOff && <div className="flex items-center justify-between gap-4 px-2">
                <label className="text-[8px] font-black uppercase text-slate-400 italic">Intervalo</label>
                <input type="number" min="1" className="w-16 p-1.5 bg-slate-50 rounded-lg font-black border-2 border-slate-100 text-slate-900 text-center text-xs" value={task.repeat_interval} onChange={e => setTask({ ...task, repeat_interval: parseInt(e.target.value) || 1 })} />
              </div>}
            </div>

            <div className="space-y-4">
              <div className="relative">
                <label className="text-[9px] font-black uppercase text-slate-400 ml-2 italic">Responsável</label>
                <button
                  type="button"
                  onClick={() => userRole !== "membro" && setShowAssignMenu(!showAssignMenu)}
                  className={`w-full h-12 px-4 rounded-xl border-2 font-black text-[10px] uppercase flex items-center justify-between transition-all relative z-[80]
                    ${showAssignMenu ? "border-blue-600 bg-white shadow-sm" : "border-slate-100 bg-slate-50 shadow-sm hover:border-blue-200 hover:bg-white"}`}
                >
                  <div className="flex items-center gap-2">
                    <User size={14} className="text-blue-500" />
                    <span className="truncate">{profiles.find(p => p.id === task.assigned_to)?.full_name || "Selecionar..."}</span>
                  </div>
                  <ChevronDown size={16} className={`transition-transform duration-300 ${showAssignMenu ? "rotate-180" : ""}`} />
                </button>

                {showAssignMenu && (
                  <>
                    <div className="fixed inset-0 z-[85]" onClick={() => setShowAssignMenu(false)}></div>
                    <div className="absolute left-0 right-0 bottom-full z-[100] mb-2 max-h-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl no-scrollbar animate-in slide-in-from-bottom-2">
                      <div className="flex flex-col gap-1">
                        {profiles.filter(p => userRole === "admin" || p.sector === userSector).map(p => (
                          <button key={p.id} type="button" onClick={() => { setTask({ ...task, assigned_to: p.id }); setShowAssignMenu(false); }} className={`p-2.5 text-left font-black text-[9px] uppercase flex items-center gap-2 rounded-lg transition-all border-2 ${task.assigned_to === p.id ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-slate-50 text-slate-600 hover:border-blue-300"}`}>
                            <div className={`w-5 h-5 rounded-md border flex items-center justify-center text-[7px] font-bold ${task.assigned_to === p.id ? "bg-white/20" : "bg-blue-100 text-blue-600"}`}>{p.full_name?.charAt(0)}</div>
                            {p.full_name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="rounded-2xl border-2 border-slate-100 bg-slate-50 p-3">
                <label className="mb-2 flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-400">
                  <Flag size={13} className="text-blue-500" /> Prioridade
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {TASK_PRIORITY_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setTask({ ...task, priority: option.value })}
                      className={`rounded-xl border-2 px-2 py-2 text-left transition-all ${
                        task.priority === option.value
                          ? option.activeClassName
                          : "border-slate-100 bg-white text-slate-500 hover:border-blue-200 hover:text-slate-900"
                      }`}
                    >
                      <span className="block text-[10px] font-black uppercase">{option.label}</span>
                      <span className={`mt-0.5 block text-[8px] font-black uppercase ${task.priority === option.value ? "text-white/75" : "text-slate-300"}`}>
                        {option.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative">
                <label className="text-[9px] font-black uppercase text-slate-400 ml-2 italic">Classificação</label>
                <button
                  type="button"
                  onClick={() => setShowCategoryMenu(!showCategoryMenu)}
                  className={`w-full h-12 px-4 rounded-xl border-2 font-black text-[10px] uppercase flex items-center justify-between transition-all relative z-[80]
                    ${showCategoryMenu ? "border-blue-600 bg-white shadow-sm" : "border-slate-100 bg-slate-50 shadow-sm hover:border-blue-200 hover:bg-white"}`}
                >
                  <div className="flex items-center gap-2">
                    <Activity size={14} className="text-blue-500" />
                    <span>{task.category}</span>
                  </div>
                  <ChevronDown size={16} className={`transition-transform duration-300 ${showCategoryMenu ? "rotate-180" : ""}`} />
                </button>
                {showCategoryMenu && (
                  <>
                    <div className="fixed inset-0 z-[85]" onClick={() => setShowCategoryMenu(false)}></div>
                    <div className="absolute left-0 right-0 bottom-full z-[100] mb-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl animate-in slide-in-from-bottom-2">
                      <div className="flex flex-col gap-1">
                        {taskCategoryOptions.map(opt => (
                          <button key={opt} type="button" onClick={() => { setTask({ ...task, category: opt, notes: opt === MARGIN_FLOW_CATEGORY ? task.notes : parseMarginFlowTaskNotes(task.notes || "").cleanNotes }); setShowCategoryMenu(false); }} className={`p-3 text-left font-black text-[10px] uppercase rounded-lg transition-all border-2 ${task.category === opt ? "bg-blue-600 border-blue-600 text-white shadow-md" : "bg-white border-slate-50 text-slate-600 hover:border-blue-300"}`}>{opt}</button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-auto flex shrink-0 gap-3 border-t-2 border-slate-100 px-5 py-4">
          <button
            onClick={onClose}
            className="h-12 flex-1 rounded-2xl bg-slate-100 text-xs font-black uppercase text-slate-500 transition hover:bg-slate-200"
          >
            Cancelar
          </button>
          <button
            onClick={onSave}
            className="flex-[2] h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-2 active:scale-95"
          >
            <Check size={18} strokeWidth={4} /> Atualizar tarefa Agora
          </button>
        </div>
      </div>
    </div>
  );
}
