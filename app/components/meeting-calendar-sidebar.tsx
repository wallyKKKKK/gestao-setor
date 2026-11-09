'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, Plus, RefreshCw, X } from 'lucide-react';
import { CALENDAR_COLORS, type MeetingCalendar } from '@/lib/meeting-calendars';
import type { GoogleCalendarListEntry } from '@/lib/google-calendar';
import { showGoogleConnectAction } from '@/lib/google-calendar-client';

export function MeetingCalendarSidebar({ userId, sector, calendars, googleCalendars, hidden, onToggle, onCreate, onRefresh, loading, googleConnected, googleConfigured, googleReconnectRequired, googleError, onConnect }: {
  userId: string; sector: string; calendars: MeetingCalendar[]; googleCalendars: GoogleCalendarListEntry[];
  hidden: string[]; onToggle: (key: string) => void;
  onCreate: (name: string, color: string, visibility: 'personal' | 'sector') => Promise<void>;
  onRefresh: () => void; loading: boolean; googleConnected: boolean; googleConfigured: boolean; googleReconnectRequired: boolean; googleError: string; onConnect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(CALENDAR_COLORS[0]);
  const [visibility, setVisibility] = useState<'personal' | 'sector'>('personal');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current || !name.trim()) return;
    lock.current = true; setSaving(true); setError('');
    try { await onCreate(name, color, visibility); setOpen(false); }
    catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível criar a agenda.'); }
    finally { lock.current = false; setSaving(false); }
  };
  const row = (key: string, name: string, color: string, detail?: string) => <label key={key} className="flex cursor-pointer items-start gap-2.5 rounded px-2 py-2 hover:bg-slate-100">
    <input type="checkbox" checked={!hidden.includes(key)} onChange={() => onToggle(key)} style={{ accentColor: color }} className="mt-0.5 h-4 w-4 shrink-0" />
    <span className="min-w-0"><span title={name} className="block truncate text-sm text-slate-800">{name}</span>{detail && <span className="block truncate text-[11px] text-slate-500">{detail}</span>}</span>
  </label>;
  const group = (title: string, rows: React.ReactNode, add?: boolean) => <details open className="border-b border-slate-200 py-2 last:border-b-0"><summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-1 text-sm font-semibold text-slate-800"><span>{title}</span><span className="flex items-center gap-1">{add && <button type="button" title="Criar agenda" aria-label="Criar agenda" disabled={loading} onClick={event => { event.preventDefault(); setName(''); setError(''); setOpen(true); }} className="rounded p-1 hover:bg-slate-200 disabled:opacity-40"><Plus size={16} /></button>}<ChevronDown size={15} /></span></summary>{rows}</details>;
  return <>
    <aside aria-label="Agendas" className="max-h-[32dvh] shrink-0 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 md:max-h-none md:w-56">
      <div className="flex items-center justify-between px-2 pb-1"><h2 className="text-sm font-semibold">Agendas</h2><button type="button" title="Atualizar agendas" aria-label="Atualizar agendas" onClick={onRefresh} disabled={loading} className="rounded p-1 text-slate-500 hover:bg-slate-200"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button></div>
      {group('Minhas agendas', <>{calendars.filter(calendar => calendar.owner_id === userId).map(calendar => row(`local:${calendar.id}`, calendar.name, calendar.color, calendar.visibility === 'personal' ? 'Pessoal · só você' : `Setor · ${calendar.sector}`))}{!calendars.some(calendar => calendar.owner_id === userId) && <p className="px-2 py-2 text-xs text-slate-500">Nenhuma agenda criada.</p>}</>, true)}
      {group('Outras agendas', <>{row('legacy', 'Agenda do setor', '#0891b2', sector)}{calendars.filter(calendar => calendar.owner_id !== userId).map(calendar => row(`local:${calendar.id}`, calendar.name, calendar.color, `Setor · ${calendar.sector}`))}</>)}
      {group('Google Agenda', <>{googleCalendars.map(calendar => row(`google:${calendar.id}`, calendar.summary, calendar.backgroundColor || '#0284c7', calendar.primary ? 'Principal' : calendar.accessRole === 'owner' ? 'Minha agenda Google' : 'Agenda compartilhada'))}
        {!googleConnected && <p className="px-2 py-2 text-xs text-slate-500">{googleConfigured ? 'Conecte sua conta para listar as agendas.' : 'Integração Google não configurada neste ambiente.'}</p>}
        {googleError && <p role="alert" className="px-2 py-2 text-xs text-amber-700">{googleError}</p>}
        {showGoogleConnectAction(googleConfigured, googleConnected, googleReconnectRequired) && <button type="button" onClick={onConnect} className="mx-2 my-2 text-xs font-semibold text-sky-700 hover:underline">{googleConnected ? 'Autorizar / reconectar Google' : 'Conectar Google'}</button>}
      </>)}
    </aside>
    {open && <dialog ref={dialog} aria-labelledby="new-calendar-title" onCancel={event => { if (lock.current) event.preventDefault(); else setOpen(false); }} onClose={() => { if (!lock.current) setOpen(false); }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100vw-24px)] max-w-md overflow-y-auto rounded-lg border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/40">
      <form onSubmit={submit}>
        <div className="flex items-center justify-between border-b border-slate-200 p-4"><h2 id="new-calendar-title" className="font-semibold">Nova agenda</h2><button type="button" aria-label="Fechar nova agenda" disabled={saving} onClick={() => setOpen(false)} className="rounded p-1"><X size={18} /></button></div>
        <fieldset disabled={saving} className="space-y-4 p-4">
          <label className="block text-sm font-medium">Nome<input autoFocus required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="Ex.: Comercial, Férias, Pessoal" className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-sm" /></label>
          <fieldset><legend className="mb-2 text-sm font-medium">Visibilidade</legend><div className="flex flex-wrap gap-4"><label className="flex items-center gap-2 text-sm"><input type="radio" name="calendar-visibility" checked={visibility === 'personal'} onChange={() => setVisibility('personal')} /> Pessoal</label><label className="flex items-center gap-2 text-sm"><input type="radio" name="calendar-visibility" checked={visibility === 'sector'} onChange={() => setVisibility('sector')} /> Compartilhada com o setor</label></div><p className="mt-2 text-xs text-slate-500">{visibility === 'personal' ? 'Só você pode ver os eventos desta agenda no app.' : `Os usuários do setor ${sector} podem ver esta agenda.`}</p></fieldset>
          <fieldset><legend className="mb-2 text-sm font-medium">Cor</legend><div className="flex flex-wrap gap-2">{CALENDAR_COLORS.map(value => <button key={value} type="button" title={`Cor ${value}`} aria-label={`Cor ${value}`} aria-pressed={color === value} onClick={() => setColor(value)} style={{ backgroundColor: value }} className={`h-7 w-7 rounded-full border-2 ${color === value ? 'border-slate-950 ring-2 ring-slate-300' : 'border-transparent'}`} />)}</div></fieldset>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </fieldset>
        <div className="flex justify-end gap-2 border-t border-slate-200 p-4"><button type="button" disabled={saving} onClick={() => setOpen(false)} className="rounded-md border border-slate-200 px-3 py-2 text-sm">Cancelar</button><button type="submit" disabled={saving} className="rounded-md bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Criando...' : 'Criar agenda'}</button></div>
      </form>
    </dialog>}
  </>;
}
