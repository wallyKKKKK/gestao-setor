'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BadgePercent, CalendarDays, ClipboardList, Clock3, Database, ListTodo, NotebookPen, PackageSearch, ShoppingCart, Shuffle, SlidersHorizontal, Tags, Truck, Users, X } from 'lucide-react';
import type { UserRole } from '@/lib/types';
import { getSectionTheme } from '@/lib/section-theme';
import { supabase } from '@/lib/supabase';

export type AppSection = 'INICIO' | 'TAREFAS' | 'REUNIAO' | 'COMPRAS_IA' | 'CADASTROS' | 'ESTOQUE_ERP' | 'PRECIFICACAO' | 'PRE_VENCIDOS' | 'PRAZOS' | 'TRANSPORTE' | 'BALACUBACO' | 'AUDITORIA' | 'NOTAS' | 'USUARIOS';

interface AppSidebarProps {
  activeSection: AppSection;
  userRole: UserRole;
  userSector: string;
  isSupremeAdmin: boolean;
  userId: string;
  availableSections: AppSection[];
  onSectionChange: (section: AppSection) => void;
}

const items = [
  { id: 'TAREFAS' as const, label: 'Tarefas', icon: ListTodo },
  { id: 'REUNIAO' as const, label: 'Reuniao', icon: CalendarDays },
  { id: 'NOTAS' as const, label: 'Notas', icon: NotebookPen },
  { id: 'COMPRAS_IA' as const, label: 'Compras IA', icon: ShoppingCart },
  { id: 'CADASTROS' as const, label: 'Cadastros', icon: Database },
  { id: 'ESTOQUE_ERP' as const, label: 'Estoque', icon: PackageSearch },
  { id: 'PRECIFICACAO' as const, label: 'Price', icon: Tags },
  { id: 'PRE_VENCIDOS' as const, label: 'Pré-venc.', icon: BadgePercent },
  { id: 'PRAZOS' as const, label: 'Prazos', icon: Clock3 },
  { id: 'TRANSPORTE' as const, label: 'Transporte', icon: Truck },
  { id: 'BALACUBACO' as const, label: 'Remanej.', icon: Shuffle },
  { id: 'AUDITORIA' as const, label: 'Auditoria', icon: ClipboardList },
  { id: 'USUARIOS' as const, label: 'Usuários', icon: Users },
];
const defaults: AppSection[] = ['TAREFAS', 'REUNIAO', 'NOTAS', 'ESTOQUE_ERP', 'BALACUBACO', 'AUDITORIA'];
const validSections = (value: unknown): AppSection[] => Array.isArray(value)
  ? Array.from(new Set(value.filter((id): id is AppSection => items.some(item => item.id === id)))) : [];

function readCachedSections(userId: string): AppSection[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = JSON.parse(window.localStorage.getItem(`wally-sidebar:${userId}`) || 'null');
    return Array.isArray(cached) ? validSections(cached) : null;
  } catch { return null; }
}

function cacheSections(userId: string, sections: AppSection[]) {
  try { window.localStorage.setItem(`wally-sidebar:${userId}`, JSON.stringify(sections)); }
  catch { /* The current selection still stays in memory if storage is unavailable. */ }
}

export function AppSidebar({
  activeSection,
  userId,
  availableSections,
  onSectionChange,
}: AppSidebarProps) {
  const [selected, setSelected] = useState<AppSection[] | null>(() => readCachedSections(userId));
  const [draft, setDraft] = useState<AppSection[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const saveLock = useRef(false);
  const allowedItems = items.filter(item => availableSections.includes(item.id));
  const visibleItems = (selected ?? (loading ? [] : defaults)).filter(id => availableSections.includes(id)).flatMap(id => items.filter(item => item.id === id));
  const homeTheme = getSectionTheme('INICIO');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data, error } = await supabase.from('sidebar_preferences').select('sections').eq('user_id', userId).maybeSingle();
        if (error) throw error;
        if (!cancelled) {
          const sections = data ? validSections(data.sections) : defaults;
          cacheSections(userId, sections);
          setSelected(sections);
        }
      } catch {
        if (!cancelled) setError('Não foi possível carregar seus atalhos. Tente novamente ao reabrir a seção.');
      } finally { if (!cancelled) setLoading(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [userId]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  const save = async () => {
    if (saveLock.current || loading) return;
    saveLock.current = true;
    setSaving(true);
    setError('');
    const sections = draft.filter(id => availableSections.includes(id));
    try {
      const { error } = await supabase.from('sidebar_preferences').upsert({ user_id: userId, sections, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }).select('sections').single();
      if (error) throw error;
      cacheSections(userId, sections);
      setSelected(sections);
      setOpen(false);
    } catch { setError('Não foi possível salvar os atalhos. Sua seleção foi mantida; tente novamente.'); }
    finally { saveLock.current = false; setSaving(false); }
  };

  return (
    <><aside aria-label="Atalhos dos módulos" className="fixed bottom-0 left-0 right-0 md:top-0 md:bottom-0 md:right-auto md:w-20 bg-[#151D33] text-white z-50 border-t md:border-t-0 md:border-r border-white/10">
      <div className="h-[76px] md:h-full min-h-0 flex md:flex-col items-center gap-2 md:gap-3 md:py-3 px-2 md:px-0">
        <button
          type="button"
          onClick={() => onSectionChange('INICIO')}
          className={[
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl font-black italic shadow-lg transition-all',
            activeSection === 'INICIO' ? 'bg-white ring-2 ring-white/30' : 'text-white hover:brightness-110',
          ].join(' ')}
          style={activeSection === 'INICIO' ? { color: homeTheme.accent } : { backgroundColor: homeTheme.accent }}
          aria-label="Voltar para o inicio"
          title="Inicio"
        >
          W
        </button>

        <div className="flex min-h-0 min-w-0 flex-1 md:flex-col items-center gap-2 w-full overflow-x-auto md:overflow-x-hidden md:overflow-y-auto no-scrollbar">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            const itemTheme = getSectionTheme(item.id);

            return (
              <button
                key={item.id}
                type="button"
                title={item.label}
                aria-label={item.label}
                onClick={() => onSectionChange(item.id)}
                className={[
                  'h-[60px] w-16 shrink-0 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all border',
                  isActive ? 'bg-white border-white' : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white',
                ].join(' ')}
                style={isActive ? { color: itemTheme.accent, boxShadow: '0 8px 24px ' + itemTheme.accent + '40' } : undefined}
              >
                <Icon size={20} strokeWidth={isActive ? 3 : 2} />
                <span className="text-[8px] font-black uppercase tracking-widest">{item.label}</span>
              </button>
            );
          })}
        </div>
        <button type="button" title="Personalizar atalhos" aria-label="Personalizar atalhos" onClick={() => { setDraft((selected ?? defaults).filter(id => availableSections.includes(id))); setOpen(true); }} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"><SlidersHorizontal size={20} /></button>
      </div>
    </aside>
    {open && createPortal(<dialog ref={dialog} aria-labelledby="sidebar-settings-title" onCancel={event => { if (saving) event.preventDefault(); else setOpen(false); }} onClose={() => { if (!saving) setOpen(false); }} className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100vw-24px)] max-w-md overflow-y-auto rounded-lg border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/30">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><h2 id="sidebar-settings-title" className="text-base font-semibold">Personalizar atalhos</h2><button type="button" disabled={saving} aria-label="Fechar personalização" title="Fechar" onClick={() => setOpen(false)} className="rounded p-1 hover:bg-slate-100"><X size={18} /></button></div>
      <div className="p-4">
        {error && <p role="alert" className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">{error}</p>}
        {loading ? <p role="status" className="text-sm text-slate-500">Carregando atalhos...</p> : <div className="space-y-1">{allowedItems.map(item => {
          const Icon = item.icon;
          return <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-slate-50"><input type="checkbox" disabled={saving} checked={draft.includes(item.id)} onChange={event => setDraft(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} className="h-4 w-4 accent-teal-700" /><Icon size={18} style={{ color: getSectionTheme(item.id).accent }} /><span className="text-sm">{item.id === 'PRE_VENCIDOS' ? 'Pré-vencidos' : item.id === 'BALACUBACO' ? 'Remanejamento' : item.id === 'ESTOQUE_ERP' ? 'Estoque ERP' : item.label}</span></label>;
        })}</div>}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 p-4"><button type="button" disabled={saving || loading} onClick={() => setDraft(defaults.filter(id => availableSections.includes(id)))} className="text-xs font-medium text-slate-600 hover:underline">Restaurar padrão</button><button type="button" disabled={saving || loading} onClick={() => void save()} className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Salvando...' : 'Salvar atalhos'}</button></div>
    </dialog>, document.body)}
    </>
  );
}
