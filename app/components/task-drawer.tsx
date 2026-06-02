"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Edit3, FileText, MessageSquare, Plus, Trash2, X } from "lucide-react";
import { createTradeTaskNote, deleteTradeTaskNote, fetchTradeTaskNotes } from "@/lib/api";
import type { ProcessedTask, Profile, Subtask, TradeTaskNote, UserRole } from "@/lib/types";
import type { User as SupabaseUser } from "@supabase/supabase-js";

interface TaskDrawerProps {
  task: ProcessedTask | null;
  profiles: Profile[];
  user: SupabaseUser | null;
  userRole: UserRole;
  onTradeNotesChanged: () => void;
  onClose: () => void;
  onEdit: (task: ProcessedTask) => void;
}

export function TaskDrawer({ task, profiles, user, userRole, onTradeNotesChanged, onClose, onEdit }: TaskDrawerProps) {
  const [tradeNotes, setTradeNotes] = useState<TradeTaskNote[]>([]);
  const [tradeNoteText, setTradeNoteText] = useState("");
  const [loadingTradeNotes, setLoadingTradeNotes] = useState(false);
  const [savingTradeNote, setSavingTradeNote] = useState(false);
  const isTradeTask = task?.category === "Trade";

  useEffect(() => {
    let isCurrent = true;

    if (!task?.id || !isTradeTask) {
      queueMicrotask(() => {
        if (!isCurrent) return;
        setTradeNotes([]);
        setTradeNoteText("");
      });
      return;
    }

    queueMicrotask(() => {
      if (isCurrent) setLoadingTradeNotes(true);
    });
    fetchTradeTaskNotes(task.id)
      .then((notes) => {
        if (isCurrent) setTradeNotes(notes);
      })
      .catch(() => {
        if (isCurrent) setTradeNotes([]);
      })
      .finally(() => {
        if (isCurrent) setLoadingTradeNotes(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [isTradeTask, task?.id]);

  const addTradeNote = async () => {
    if (!task || !user || !tradeNoteText.trim()) return;

    setSavingTradeNote(true);
    try {
      const note = await createTradeTaskNote(task.id, tradeNoteText.trim(), user.id);
      setTradeNotes((current) => [note, ...current]);
      setTradeNoteText("");
      onTradeNotesChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      alert("Erro ao salvar nota de Trade: " + message);
    } finally {
      setSavingTradeNote(false);
    }
  };

  const removeTradeNote = async (noteId: string) => {
    if (!confirm("Excluir esta nota de Trade?")) return;

    try {
      await deleteTradeTaskNote(noteId);
      setTradeNotes((current) => current.filter((note) => note.id !== noteId));
      onTradeNotesChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      alert("Erro ao excluir nota de Trade: " + message);
    }
  };

  return (
    <div className={`fixed inset-0 z-[100] transition-all duration-500 ${task ? "visible" : "invisible pointer-events-none"}`}>
      <div
        className={`absolute inset-0 bg-slate-900/10 transition-opacity duration-500 ${task ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />

      <div
        className={`absolute top-0 right-0 h-full bg-white w-full md:w-[420px] border-l-2 border-slate-200 shadow-[-10px_0_30px_rgba(0,0,0,0.05)] flex flex-col transition-transform duration-500 ease-in-out transform z-[110]
          ${task ? "translate-x-0" : "translate-x-full"}`}
      >
        {task && (
          <div className="flex flex-col h-full overflow-hidden bg-[#F8FAFC]">
            <div className={`p-8 border-b-2 border-white/10 ${task.isDoneToday ? "bg-green-600" : "bg-[#232D4A]"} text-white relative`}>
              <div className="flex justify-between items-center mb-6">
                <span className="bg-white/10 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border border-white/10">
                  {task.category}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onClose(); }}
                  className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/20 text-white transition-all"
                >
                  <X size={24} strokeWidth={3}/>
                </button>
              </div>
              <h2 className="text-2xl font-black uppercase italic tracking-tighter leading-tight break-words">
                {task.title}
              </h2>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm">
                  <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Responsável</p>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-slate-900 text-white rounded-md flex items-center justify-center text-[10px] font-black uppercase">
                      {profiles.find(p => p.id === task.assigned_to)?.full_name?.charAt(0)}
                    </div>
                    <span className="font-bold text-[11px] text-slate-900 uppercase truncate">
                      {profiles.find(p => p.id === task.assigned_to)?.full_name}
                    </span>
                  </div>
                </div>
                <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm">
                  <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Setor</p>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                    <span className="font-bold text-[11px] text-slate-900 uppercase">{task.sector}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 flex items-center gap-2">
                  <FileText size={12}/> Instruções da Missão
                </label>
                <div className="bg-white p-6 rounded-2xl border border-slate-200 text-slate-700 font-medium leading-relaxed whitespace-pre-wrap text-sm break-all shadow-sm">
                  {task.notes || "Sem notas adicionais."}
                </div>
              </div>

              {isTradeTask && (
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 flex items-center gap-2">
                    <MessageSquare size={12}/> Notas de Trade
                  </label>
                  <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-3 shadow-sm">
                    <textarea
                      value={tradeNoteText}
                      onChange={(event) => setTradeNoteText(event.target.value)}
                      placeholder="Adicionar uma atualizacao rapida..."
                      className="min-h-20 w-full resize-none rounded-xl border-2 border-white bg-white p-3 text-xs font-bold text-slate-700 outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={addTradeNote}
                      disabled={savingTradeNote || !tradeNoteText.trim()}
                      className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white transition-all disabled:opacity-50"
                    >
                      <Plus size={14} /> {savingTradeNote ? "Salvando..." : "Adicionar nota"}
                    </button>
                  </div>

                  <div className="space-y-2">
                    {loadingTradeNotes && (
                      <div className="rounded-xl bg-white p-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-300">
                        Carregando notas...
                      </div>
                    )}
                    {!loadingTradeNotes && tradeNotes.length === 0 && (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-300">
                        Nenhuma nota de Trade
                      </div>
                    )}
                    {tradeNotes.map((note) => {
                      const canDeleteNote = note.created_by === user?.id || userRole === "admin" || userRole === "gerente";
                      return (
                        <div key={note.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-[10px] font-black uppercase text-slate-700">
                                {note.profiles?.full_name || "Usuario"}
                              </p>
                              <p className="text-[9px] font-bold uppercase text-slate-400">
                                {new Date(note.created_at).toLocaleString("pt-BR")}
                              </p>
                            </div>
                            {canDeleteNote && (
                              <button
                                onClick={() => removeTradeNote(note.id)}
                                className="rounded-lg bg-red-50 p-2 text-red-500 transition-all hover:bg-red-100"
                                aria-label="Excluir nota"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-slate-700">
                            {note.content}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {task.subtasks?.length > 0 && (
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 text-center block">Checklist de Execução</label>
                  <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-sm">
                    {task.subtasks.map((sub: Subtask, i: number) => (
                      <div key={i} className="flex items-center gap-4 p-4 transition-all">
                        {sub.done ? <CheckCircle2 size={18} className="text-green-500" /> : <div className="w-4 h-4 rounded-full border-2 border-slate-200" />}
                        <span className={`text-[10px] font-black uppercase ${sub.done ? "line-through text-slate-300" : "text-slate-600"}`}>{sub.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 bg-white border-t border-slate-200 flex gap-3">
              {(userRole === "admin" || userRole === "gerente" || task.assigned_to === user?.id) && (
                <button
                  onClick={() => onEdit(task)}
                  className="flex-[2] bg-[#232D4A] text-white p-4 rounded-xl font-black uppercase tracking-widest hover:bg-blue-600 transition-all flex items-center justify-center gap-2 text-[11px] shadow-md"
                >
                  <Edit3 size={16} /> Editar
                </button>
              )}
              <button
                onClick={onClose}
                className="flex-1 py-4 rounded-xl border border-slate-200 font-black uppercase text-[10px] text-slate-400 hover:bg-slate-50 transition-all"
              >
                Sair
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
