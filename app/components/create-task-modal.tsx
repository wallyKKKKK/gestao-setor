"use client";

import type { RefObject } from "react";
import { Activity, Calendar, Check, ChevronDown, ListChecks, Plus, User, X } from "lucide-react";
import { TASK_CATEGORIES, WEEK_DAYS } from "@/app/constants";
import { buildMonthlyWeekdayRepeat, MONTHLY_WEEKDAY_ORDINALS, parseMonthlyWeekdayRepeat } from "@/lib/task-recurrence";
import type { Profile, Subtask, UserRole } from "@/lib/types";

interface CreateTaskModalProps {
  taskTitle: string;
  setTaskTitle: (value: string) => void;
  notes: string;
  setNotes: (value: string) => void;
  assignedTo: string;
  setAssignedTo: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  taskScheduleMode: "pontual" | "semanal" | "mensal";
  setTaskScheduleMode: (value: "pontual" | "semanal" | "mensal") => void;
  oneOffDate: string;
  setOneOffDate: (value: string) => void;
  repeatInterval: number;
  setRepeatInterval: (value: number) => void;
  selectedDays: string[];
  setSelectedDays: (value: string[]) => void;
  tempSubtasks: Subtask[];
  setTempSubtasks: (value: Subtask[]) => void;
  displayDate: string;
  setDisplayDate: (value: string) => void;
  dateInputRef: RefObject<HTMLInputElement | null>;
  profiles: Profile[];
  userRole: UserRole;
  userSector: string;
  showAssignMenu: boolean;
  setShowAssignMenu: (show: boolean) => void;
  showCategoryMenu: boolean;
  setShowCategoryMenu: (show: boolean) => void;
  onToggleDay: (day: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export function CreateTaskModal({
  taskTitle,
  setTaskTitle,
  notes,
  setNotes,
  assignedTo,
  setAssignedTo,
  category,
  setCategory,
  taskScheduleMode,
  setTaskScheduleMode,
  oneOffDate,
  setOneOffDate,
  repeatInterval,
  setRepeatInterval,
  selectedDays,
  setSelectedDays,
  tempSubtasks,
  setTempSubtasks,
  displayDate,
  setDisplayDate,
  dateInputRef,
  profiles,
  userRole,
  userSector,
  showAssignMenu,
  setShowAssignMenu,
  showCategoryMenu,
  setShowCategoryMenu,
  onToggleDay,
  onClose,
  onSave,
}: CreateTaskModalProps) {
  const isMonthly = taskScheduleMode === "mensal";
  const isOneOff = taskScheduleMode === "pontual";
  const monthlyWeekdayRepeat = parseMonthlyWeekdayRepeat(selectedDays[0]);
  const isMonthlyWeekday = isMonthly && Boolean(monthlyWeekdayRepeat);
  const selectedMonthlyOrdinal = monthlyWeekdayRepeat?.ordinal || "1";
  const selectedMonthlyWeekday = monthlyWeekdayRepeat?.weekday || "seg";
  const setMonthlyWeekdayRepeat = (ordinal: typeof selectedMonthlyOrdinal, weekday: string) => {
    setSelectedDays([buildMonthlyWeekdayRepeat(ordinal, weekday)]);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/16 p-3 backdrop-blur-sm animate-in fade-in">
      <div className="relative flex w-full max-w-4xl flex-col overflow-visible rounded-[30px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
        <div className="hidden absolute top-0 left-0 w-full h-2 bg-blue-600 rounded-t-[40px] overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-indigo-600 opacity-90"></div>
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: `linear-gradient(45deg, #white 25%, transparent 25%, transparent 50%, #white 50%, #white 75%, transparent 75%, transparent)`,
              backgroundSize: "10px 10px",
            }}
          ></div>
          <div className="absolute inset-0 shadow-[inset_0_-2px_4px_rgba(0,0,0,0.1)]"></div>
        </div>

        <div className="flex items-center justify-between border-b-2 border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-xl font-black uppercase italic tracking-tighter text-slate-900 leading-none text-left">Nova Tarefa</h2>
            <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest mt-1 text-left">Setor Operacional: {userSector}</p>
          </div>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 transition hover:bg-slate-200">
            <X size={21} strokeWidth={3} />
          </button>
        </div>

        <div className="flex-1 p-5 space-y-4 no-scrollbar">
          <div className="grid gap-3 md:grid-cols-2">
            <input className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 text-sm font-black uppercase text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 md:col-span-2" placeholder="O QUE VAMOS FAZER?" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} />
            <textarea className="h-20 w-full resize-none rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none transition focus:border-blue-600 md:col-span-2" placeholder="Coordenadas e detalhes da tarefa..." value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <div className="space-y-3 rounded-2xl border-2 border-slate-100 bg-slate-50 p-4">
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-2"><ListChecks size={14} className="text-blue-500"/> Passos de Execução</label>
            <div className="grid grid-cols-1 gap-2">
              {tempSubtasks.map((sub, index) => (
                <div key={index} className="flex items-center gap-2 bg-white p-2.5 rounded-xl border-2 border-slate-100 shadow-sm">
                  <input className="flex-1 text-xs font-black text-slate-600 outline-none uppercase" value={sub.title} onChange={(e) => { const newSubs = [...tempSubtasks]; newSubs[index].title = e.target.value; setTempSubtasks(newSubs); }} placeholder="Nome do passo..." />
                  <button onClick={() => setTempSubtasks(tempSubtasks.filter((_, i) => i !== index))} className="text-red-400 p-1 hover:bg-red-50 rounded-lg"><X size={14}/></button>
                </div>
              ))}
              <button onClick={() => setTempSubtasks([...tempSubtasks, { title: "", done: false }])} className="flex items-center justify-center gap-2 p-2 border-2 border-dashed border-slate-300 rounded-xl text-slate-400 font-black text-[9px] hover:border-blue-400 transition-all uppercase"><Plus size={14} strokeWidth={3}/> Adicionar Passo</button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div className="space-y-3 bg-white p-4 rounded-[24px] border-2 border-slate-100 shadow-sm">
              <div className="flex bg-slate-100 p-1 rounded-xl border-2 border-slate-200">
                <button type="button" onClick={() => { const [y, m, d] = oneOffDate.split("-"); setTaskScheduleMode("pontual"); setSelectedDays([]); setDisplayDate(`${d}/${m}/${y}`); }} className={`flex-1 py-1.5 rounded-lg font-black text-[9px] uppercase transition-all ${isOneOff ? "bg-white text-blue-600 shadow-sm" : "text-slate-400"}`}>Pontual</button>
                <button type="button" onClick={() => { setTaskScheduleMode("semanal"); setSelectedDays([]); }} className={`flex-1 py-1.5 rounded-lg font-black text-[9px] uppercase transition-all ${taskScheduleMode === "semanal" ? "bg-white text-blue-600 shadow-sm" : "text-slate-400"}`}>Semanal</button>
                <button type="button" onClick={() => { setTaskScheduleMode("mensal"); setSelectedDays(["1"]); }} className={`flex-1 py-1.5 rounded-lg font-black text-[9px] uppercase transition-all ${isMonthly ? "bg-white text-blue-600 shadow-sm" : "text-slate-400"}`}>Mensal</button>
              </div>
              {isOneOff ? (
                <div className="space-y-2">
                  <label className="text-[8px] font-black uppercase text-slate-400 italic">Data de execução</label>
                  <div className="relative h-[50px] group cursor-pointer" onClick={() => dateInputRef.current?.showPicker()}>
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-50 rounded-xl border-2 border-slate-100 font-black text-slate-700 text-base pointer-events-none uppercase">
                      {displayDate === "DD/MM/YYYY" ? "Hoje" : displayDate}
                      <Calendar size={16} className="absolute right-4 text-blue-500" />
                    </div>
                    <input ref={dateInputRef} type="date" value={oneOffDate} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={e => { const dVal = e.target.value; if (dVal) { const [y, m, d] = dVal.split("-"); setOneOffDate(dVal); setDisplayDate(`${d}/${m}/${y}`); }}} />
                  </div>
                </div>
              ) : isMonthly ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 rounded-xl border-2 border-slate-100 bg-slate-50 p-1">
                    <button type="button" onClick={() => setSelectedDays(["1"])} className={`rounded-lg py-2 text-[9px] font-black uppercase transition ${!isMonthlyWeekday ? "bg-white text-blue-600 shadow-sm" : "text-slate-400"}`}>Dia fixo</button>
                    <button type="button" onClick={() => setMonthlyWeekdayRepeat("1", "seg")} className={`rounded-lg py-2 text-[9px] font-black uppercase transition ${isMonthlyWeekday ? "bg-white text-blue-600 shadow-sm" : "text-slate-400"}`}>Dia da semana</button>
                  </div>

                  {!isMonthlyWeekday ? (
                    <div className="relative h-[50px] group cursor-pointer" onClick={() => dateInputRef.current?.showPicker()}>
                      <div className="absolute inset-0 flex items-center justify-center bg-slate-50 rounded-xl border-2 border-slate-100 font-black text-slate-700 text-base pointer-events-none uppercase">{displayDate}<Calendar size={16} className="absolute right-4 text-blue-500" /></div>
                      <input ref={dateInputRef} type="date" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={e => { const dVal = e.target.value; if (dVal) { const [y, m, d] = dVal.split("-"); setDisplayDate(`${d}/${m}/${y}`); setSelectedDays([d]); }}} />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-5 gap-1">
                        {MONTHLY_WEEKDAY_ORDINALS.map((item) => (
                          <button key={item.value} type="button" onClick={() => setMonthlyWeekdayRepeat(item.value, selectedMonthlyWeekday)} className={`h-9 rounded-xl text-[9px] font-black uppercase transition ${selectedMonthlyOrdinal === item.value ? "bg-blue-600 text-white shadow-sm" : "bg-slate-50 text-slate-400"}`}>
                            {item.label}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-5 gap-1">
                        {WEEK_DAYS.map((day) => (
                          <button key={day.id} type="button" onClick={() => setMonthlyWeekdayRepeat(selectedMonthlyOrdinal, day.id)} className={`h-9 rounded-xl text-[9px] font-black uppercase transition ${selectedMonthlyWeekday === day.id ? "bg-slate-950 text-white shadow-sm" : "bg-slate-50 text-slate-400"}`}>
                            {day.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex gap-1.5 justify-center p-1.5 bg-slate-50 rounded-xl border-2 border-slate-100">
                  {WEEK_DAYS.map(day => (<button key={day.id} type="button" onClick={() => onToggleDay(day.id)} className={`w-8 h-8 rounded-lg font-black text-[10px] transition-all ${selectedDays.includes(day.id) ? "bg-blue-600 text-white shadow-lg scale-110" : "bg-white text-slate-300"}`}>{day.label}</button>))}
                </div>
              )}
              {!isOneOff && <div className="flex items-center justify-between gap-4 px-2"><label className="text-[8px] font-black uppercase text-slate-400 italic">Intervalo</label><input type="number" min="1" className="w-16 p-1.5 bg-slate-50 rounded-lg font-black border-2 border-slate-100 text-slate-900 text-center text-xs" value={repeatInterval} onChange={e => setRepeatInterval(parseInt(e.target.value) || 1)} /></div>}
            </div>

            <div className="space-y-4">
              <div className="relative">
                <label className="text-[9px] font-black uppercase text-slate-400 ml-2 italic">Responsável</label>
                <button type="button" onClick={() => userRole !== "membro" && setShowAssignMenu(!showAssignMenu)} className={`w-full h-12 px-4 rounded-xl border-2 font-black text-[10px] uppercase flex items-center justify-between transition-all relative z-20 ${showAssignMenu ? "border-blue-600 bg-white shadow-sm" : "border-slate-100 bg-slate-50 shadow-sm hover:border-blue-200 hover:bg-white"}`}>
                  <div className="flex items-center gap-2"><User size={14} className="text-blue-500" /><span>{profiles.find(p => p.id === assignedTo)?.full_name || "Selecionar..."}</span></div>
                  <ChevronDown size={16} className={`transition-transform duration-300 ${showAssignMenu ? "rotate-180" : ""}`} />
                </button>
                {showAssignMenu && (
                  <>
                    <div className="fixed inset-0 z-[85]" onClick={() => setShowAssignMenu(false)}></div>
                    <div className="absolute left-0 right-0 bottom-full z-[100] mb-2 max-h-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl no-scrollbar animate-in slide-in-from-bottom-2">
                      <div className="flex flex-col gap-1">{profiles.filter(p => userRole === "admin" || p.sector === userSector).map(p => (
                        <button key={p.id} type="button" onClick={() => { setAssignedTo(p.id); setShowAssignMenu(false); }} className={`p-2.5 text-left font-black text-[9px] uppercase flex items-center gap-2 rounded-lg transition-all border-2 ${assignedTo === p.id ? "bg-blue-600 border-blue-600 text-white shadow-md" : "bg-white border-slate-50 text-slate-600 hover:border-blue-300"}`}><div className={`w-5 h-5 rounded-md border flex items-center justify-center text-[7px] font-bold ${assignedTo === p.id ? "bg-white/20" : "bg-blue-100 text-blue-600"}`}>{p.full_name?.charAt(0)}</div>{p.full_name}</button>
                      ))}</div>
                    </div>
                  </>
                )}
              </div>

              <div className="relative">
                <label className="text-[9px] font-black uppercase text-slate-400 ml-2 italic">Classificação</label>
                <button type="button" onClick={() => setShowCategoryMenu(!showCategoryMenu)} className={`w-full h-12 px-4 rounded-xl border-2 font-black text-[10px] uppercase flex items-center justify-between transition-all relative z-20 ${showCategoryMenu ? "border-blue-600 bg-white shadow-sm" : "border-slate-100 bg-slate-50 shadow-sm hover:border-blue-200 hover:bg-white"}`}>
                  <div className="flex items-center gap-2"><Activity size={14} className="text-blue-500" /><span>{category}</span></div>
                  <ChevronDown size={16} className={`transition-transform duration-300 ${showCategoryMenu ? "rotate-180" : ""}`} />
                </button>
                {showCategoryMenu && (
                  <>
                    <div className="fixed inset-0 z-[85]" onClick={() => setShowCategoryMenu(false)}></div>
                    <div className="absolute left-0 right-0 bottom-full z-[100] mb-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl animate-in slide-in-from-bottom-2">
                      <div className="flex flex-col gap-1">{TASK_CATEGORIES.map(opt => (
                        <button key={opt} type="button" onClick={() => { setCategory(opt); setShowCategoryMenu(false); }} className={`p-3 text-left font-black text-[9px] uppercase rounded-lg transition-all border-2 ${category === opt ? "bg-blue-600 border-blue-600 text-white shadow-md" : "bg-white border-slate-50 text-slate-600 hover:border-blue-300"}`}>{opt}</button>
                      ))}</div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-auto flex gap-3 border-t-2 border-slate-100 px-5 py-4">
          <button onClick={onClose} className="h-12 flex-1 rounded-2xl bg-slate-100 text-xs font-black uppercase text-slate-500 transition hover:bg-slate-200">Descartar</button>
          <button onClick={onSave} className="flex-[2] h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-2 active:scale-95"><Check size={18} strokeWidth={4} /> Lançar Tarefa Agora</button>
        </div>
      </div>
    </div>
  );
}
