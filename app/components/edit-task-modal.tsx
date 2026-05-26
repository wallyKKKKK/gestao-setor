"use client";

import type { RefObject } from "react";
import { Activity, Calendar, Check, ChevronDown, ListChecks, Plus, User, X } from "lucide-react";
import { TASK_CATEGORIES, WEEK_DAYS } from "@/app/constants";
import type { ProcessedTask, Profile, Subtask, UserRole } from "@/lib/types";

interface EditTaskModalProps {
  task: ProcessedTask;
  setTask: (task: ProcessedTask) => void;
  profiles: Profile[];
  userRole: UserRole;
  userSector: string;
  editMode: string;
  setEditMode: (mode: string) => void;
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
  return (
    <div className="fixed inset-0 bg-slate-900/90 z-[70] flex items-center justify-center p-4 backdrop-blur-sm animate-in zoom-in-95 duration-300">
      <div className="bg-white w-full max-w-2xl rounded-[40px] border-4 border-slate-900 shadow-[20px_20px_0px_0px_rgba(15,23,42,1)] flex flex-col max-h-[90vh] overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-600 to-indigo-600"></div>

        <div className="p-6 border-b-4 border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div>
            <h2 className="text-2xl font-black uppercase italic tracking-tighter text-slate-900 leading-none">Editar tarefa</h2>
            <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest mt-1">Ajuste de Coordenadas Operacionais</p>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-white border-2 border-slate-200 text-slate-400 hover:text-red-600 transition-all shadow-sm"
          >
            <X size={20} strokeWidth={3} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar pb-6">
          <div className="space-y-4">
            <input
              className="w-full text-2xl font-black outline-none placeholder:text-slate-200 text-slate-900 bg-transparent border-b-4 border-slate-100 focus:border-blue-500 transition-all pb-2 uppercase"
              value={task.title}
              onChange={e => setTask({ ...task, title: e.target.value })}
            />
            <textarea
              className="w-full p-4 bg-slate-50 rounded-3xl font-bold text-slate-700 border-2 border-slate-100 outline-none focus:border-blue-300 focus:bg-white transition-all min-h-[80px] text-sm resize-none"
              value={task.notes || ""}
              onChange={e => setTask({ ...task, notes: e.target.value })}
            />
          </div>

          <div className="space-y-3 bg-slate-50/50 p-5 rounded-[24px] border-2 border-dashed border-slate-200">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
            <div className="space-y-3 bg-white p-4 rounded-[24px] border-2 border-slate-100 shadow-sm">
              <div className="flex bg-slate-100 p-1 rounded-xl border-2 border-slate-200">
                <button type="button" onClick={() => { setEditMode("semanal"); setTask({ ...task, repeat_days: "" }); }} className={`flex-1 py-1.5 rounded-lg font-black text-[10px] uppercase transition-all ${editMode === "semanal" ? "bg-white text-blue-600 shadow-sm" : "text-slate-400"}`}>Semanal</button>
                <button type="button" onClick={() => { setEditMode("mensal"); setTask({ ...task, repeat_days: "1" }); }} className={`flex-1 py-1.5 rounded-lg font-black text-[10px] uppercase transition-all ${editMode === "mensal" ? "bg-white text-blue-600 shadow-sm" : "text-slate-400"}`}>Mensal</button>
              </div>

              {editMode === "mensal" ? (
                <div className="space-y-2">
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
                </div>
              ) : (
                <div className="flex gap-1.5 justify-center p-1.5 bg-slate-50 rounded-xl border-2 border-slate-100">
                  {WEEK_DAYS.map(day => (
                    <button key={day.id} type="button" onClick={() => onToggleDay(day.id)} className={`w-8 h-8 rounded-lg font-black text-[10px] transition-all ${task.repeat_days?.split(",").includes(day.id) ? "bg-blue-600 text-white shadow-lg" : "bg-white text-slate-300"}`}>{day.label}</button>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between gap-4 px-2">
                <label className="text-[8px] font-black uppercase text-slate-400 italic">Intervalo</label>
                <input type="number" min="1" className="w-16 p-1.5 bg-slate-50 rounded-lg font-black border-2 border-slate-100 text-slate-900 text-center text-xs" value={task.repeat_interval} onChange={e => setTask({ ...task, repeat_interval: parseInt(e.target.value) || 1 })} />
              </div>
            </div>

            <div className="space-y-4">
              <div className="relative">
                <label className="text-[9px] font-black uppercase text-slate-400 ml-2 italic">Responsável</label>
                <button
                  type="button"
                  onClick={() => userRole !== "membro" && setShowAssignMenu(!showAssignMenu)}
                  className={`w-full h-12 px-4 rounded-xl border-2 font-black text-[10px] uppercase flex items-center justify-between transition-all relative z-[80]
                    ${showAssignMenu ? "border-blue-600 bg-white" : "border-slate-900 bg-white shadow-[3px_3px_0px_0px_rgba(15,23,42,1)]"}`}
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
                    <div className="absolute left-0 right-0 bottom-full mb-2 bg-white border-4 border-slate-900 rounded-[24px] shadow-[10px_10px_0px_0px_rgba(15,23,42,1)] z-[100] p-3 max-h-[180px] overflow-y-auto no-scrollbar animate-in slide-in-from-bottom-2">
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

              <div className="relative">
                <label className="text-[9px] font-black uppercase text-slate-400 ml-2 italic">Classificação</label>
                <button
                  type="button"
                  onClick={() => setShowCategoryMenu(!showCategoryMenu)}
                  className={`w-full h-12 px-4 rounded-xl border-2 font-black text-[10px] uppercase flex items-center justify-between transition-all relative z-[80]
                    ${showCategoryMenu ? "border-blue-600 bg-white" : "border-slate-900 bg-white shadow-[3px_3px_0px_0px_rgba(15,23,42,1)]"}`}
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
                    <div className="absolute left-0 right-0 bottom-full mb-2 bg-white border-4 border-slate-900 rounded-[24px] shadow-[10px_10px_0px_0px_rgba(15,23,42,1)] z-[100] p-3 animate-in slide-in-from-bottom-2">
                      <div className="flex flex-col gap-1">
                        {TASK_CATEGORIES.map(opt => (
                          <button key={opt} type="button" onClick={() => { setTask({ ...task, category: opt }); setShowCategoryMenu(false); }} className={`p-3 text-left font-black text-[10px] uppercase rounded-lg transition-all border-2 ${task.category === opt ? "bg-blue-600 border-blue-600 text-white shadow-md" : "bg-white border-slate-50 text-slate-600 hover:border-blue-300"}`}>{opt}</button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 bg-slate-50 border-t-4 border-slate-100 flex gap-3 mt-auto">
          <button
            onClick={onClose}
            className="flex-1 py-4 rounded-2xl border-2 border-slate-200 text-slate-400 font-black uppercase text-[10px] hover:bg-slate-100 transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={onSave}
            className="flex-[2] py-4 bg-blue-600 hover:bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95"
          >
            <Check size={20} strokeWidth={4} /> Atualizar tarefa Agora
          </button>
        </div>
      </div>
    </div>
  );
}
