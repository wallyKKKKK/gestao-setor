'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle, Plus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cleanSectorName, sectorNameKey, validateSectorName } from '@/lib/sectors';

export function SectorCreateButton({ sectors, onCreated }: { sectors: string[]; onCreated: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (open) { dialog.current?.showModal(); input.current?.focus(); }
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    const cleaned = cleanSectorName(name);
    const validation = validateSectorName(cleaned);
    if (validation) { setError(validation); return; }
    if (sectors.some(sector => sectorNameKey(sector) === sectorNameKey(cleaned))) {
      setError('Já existe um setor com este nome.');
      return;
    }
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      const { data, error } = await supabase.from('app_sectors').insert({ name: cleaned }).select('name').single();
      if (error) {
        if (mounted.current) setError(error.code === '23505' ? 'Já existe um setor com este nome. Atualize a lista de usuários.' : 'Não foi possível criar o setor. Confira sua conexão e tente novamente.');
        return;
      }
      if (!data?.name) throw new Error('Setor não retornado');
      if (!mounted.current) return;
      onCreated(data.name);
      setCreated(true);
      setOpen(false);
    } catch {
      if (mounted.current) setError('Não foi possível confirmar a criação. Atualize a lista antes de tentar novamente.');
    } finally {
      lock.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return <>
    <div className="flex items-center gap-2">
      {created && <span role="status" className="text-xs font-medium text-emerald-700">Setor criado.</span>}
      <button type="button" onClick={() => { setName(''); setError(''); setCreated(false); setOpen(true); }} className="flex h-10 shrink-0 items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 text-xs font-semibold text-sky-800 hover:bg-sky-100"><Plus size={16} /> Novo setor</button>
    </div>
    {open && <dialog ref={dialog} aria-labelledby="sector-create-title" onCancel={event => { if (lock.current) event.preventDefault(); else setOpen(false); }} onClose={() => { if (!lock.current) setOpen(false); }} className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100vw-24px)] max-w-md overflow-y-auto rounded-lg border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/40">
      <form onSubmit={event => void submit(event)}>
        <div className="flex items-center justify-between border-b border-slate-200 p-4"><h2 id="sector-create-title" className="text-base font-semibold">Novo setor</h2><button type="button" title="Fechar" aria-label="Fechar novo setor" disabled={saving} onClick={() => setOpen(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X size={19} /></button></div>
        <div className="space-y-3 p-4">
          <label className="block text-sm font-medium">Nome do setor<input ref={input} value={name} required maxLength={80} disabled={saving} onChange={event => setName(event.target.value)} placeholder="Ex.: Recursos Humanos" className="mt-2 h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100" /></label>
          {error && <p role="alert" className="text-sm font-normal text-red-700">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 p-4"><button type="button" disabled={saving} onClick={() => setOpen(false)} className="rounded-md border border-slate-200 px-3 py-2 text-sm">Cancelar</button><button type="submit" disabled={saving} className="flex items-center gap-2 rounded-md bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving && <LoaderCircle size={16} className="animate-spin" />}{saving ? 'Criando...' : 'Criar setor'}</button></div>
      </form>
    </dialog>}
  </>;
}
