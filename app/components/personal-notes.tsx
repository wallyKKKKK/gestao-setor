'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, ListTodo, Plus, RefreshCw, Save, Search, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { NoteEditor } from '@/app/components/note-editor';
import { notePlainText, noteTaskContent } from '@/lib/note-content';
import type { NoteTaskContent } from '@/lib/note-content';

interface Note { id: string; user_id: string; title: string; content: string; updated_at: string; task_id: string | number | null }
type Draft = Pick<Note, 'title' | 'content'>;

function readDrafts(key: string): Record<string, Draft> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '{}');
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, Draft] => {
      const value = entry[1] as Draft | null;
      return Boolean(value && typeof value.title === 'string' && typeof value.content === 'string');
    }));
  } catch { return {}; }
}

export function PersonalNotes({ userId, onCreateTask, onViewTask, refreshKey = 0 }: {
  userId: string;
  refreshKey?: number;
  onCreateTask: (noteId: string, title: string, content: string, subtasks: NoteTaskContent['subtasks']) => void;
  onViewTask: (taskId: string) => Promise<void>;
}) {
  const draftKey = `wally-note-drafts:${userId}`;
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => readDrafts(draftKey));
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const mounted = useRef(true);
  const request = useRef(0);
  const selected = notes.find(note => note.id === selectedId);
  const draft = selected ? drafts[selected.id] || selected : null;
  const dirty = Boolean(selected && draft && (draft.title !== selected.title || draft.content !== selected.content));

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(draftKey, JSON.stringify(drafts)); }
    catch { setError('Não foi possível guardar o rascunho neste navegador. Salve a nota antes de sair.'); }
  }, [draftKey, drafts]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (Object.keys(drafts).length) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafts]);

  const load = useCallback(async () => {
    const version = ++request.current;
    setLoading(true);
    setError('');
    try {
      const { data, error } = await supabase.from('personal_notes').select('id,user_id,title,content,updated_at,task_id').eq('user_id', userId).order('updated_at', { ascending: false });
      if (!mounted.current || version !== request.current) return;
      if (error) throw error;
      const rows = (data || []) as Note[];
      setNotes(rows);
      setSelectedId(current => rows.some(row => row.id === current) ? current : rows[0]?.id || '');
    } catch {
      if (mounted.current && version === request.current) setError('Não foi possível carregar as notas. Tente atualizar.');
    } finally {
      if (mounted.current && version === request.current) setLoading(false);
    }
  }, [userId]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const mutate = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try { await action(); }
    catch { if (mounted.current) setError('Não foi possível salvar a alteração. Seu texto foi mantido; tente novamente.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const create = () => mutate(async () => {
    const { data, error } = await supabase.from('personal_notes').insert({ user_id: userId, title: '', content: '' }).select('id,user_id,title,content,updated_at,task_id').single();
    if (error) throw error;
    if (!mounted.current) return;
    setNotes(current => [data as Note, ...current]);
    setSelectedId(data.id);
    setQuery('');
  });
  const save = () => mutate(async () => {
    if (!selected || !draft) return;
    if (draft.content.length > 100000) {
      setError('Esta nota excede o limite de tamanho. Divida o conteúdo em mais de uma nota para salvar.');
      return;
    }
    const { data, error } = await supabase.from('personal_notes').update({ title: draft.title, content: draft.content, updated_at: new Date().toISOString() }).eq('id', selected.id).eq('user_id', userId).select('id,user_id,title,content,updated_at,task_id').single();
    if (error) throw error;
    if (!mounted.current) return;
    setNotes(current => [data as Note, ...current.filter(note => note.id !== selected.id)]);
    setDrafts(current => { const next = { ...current }; delete next[selected.id]; return next; });
  });
  const remove = () => {
    if (!selected || !confirm('Excluir esta nota? Esta ação não pode ser desfeita.')) return;
    void mutate(async () => {
      const { data, error } = await supabase.from('personal_notes').delete().eq('id', selected.id).eq('user_id', userId).select('id');
      if (error || !data?.length) throw error || new Error('Nota não encontrada');
      if (!mounted.current) return;
      setNotes(current => current.filter(note => note.id !== selected.id));
      setSelectedId('');
      setDrafts(current => { const next = { ...current }; delete next[selected.id]; return next; });
    });
  };
  const edit = (field: keyof Draft, value: string) => {
    if (selected && draft) setDrafts(current => {
      const next = { ...current, [selected.id]: { title: draft.title, content: draft.content, [field]: value } };
      if (next[selected.id].title === selected.title && next[selected.id].content === selected.content) delete next[selected.id];
      return next;
    });
  };
  const filtered = notes.filter(note => {
    const text = drafts[note.id] || note;
    return `${text.title} ${notePlainText(text.content)}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'));
  });

  return (
    <main className="mx-auto max-w-[1500px] p-3 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Minhas notas <span className="ml-2 text-sm font-normal text-slate-500">{notes.length}</span></h1>
        <div className="flex gap-2">
          <button type="button" title="Atualizar notas" aria-label="Atualizar notas" disabled={busy || loading} onClick={() => void load()} className="rounded-md border border-slate-200 bg-white p-2 text-slate-600 disabled:opacity-50"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button>
          <button type="button" disabled={busy || loading} onClick={() => void create()} className="flex items-center gap-2 rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Plus size={16} /> Nova nota</button>
        </div>
      </div>
      {error && <p role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="grid min-h-[65vh] overflow-hidden rounded-lg border border-slate-200 bg-white md:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 md:border-b-0 md:border-r">
          <div className="relative m-3"><Search size={16} className="absolute left-3 top-3 text-slate-400" /><input aria-label="Buscar notas" placeholder="Buscar notas..." value={query} onChange={event => setQuery(event.target.value)} className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm" /></div>
          <div className="max-h-48 overflow-y-auto md:max-h-[65vh]">
            {loading && !notes.length ? <p role="status" className="p-4 text-sm text-slate-500">Carregando notas...</p> : !filtered.length ? <p className="p-4 text-sm text-slate-500">{query ? 'Nenhuma nota encontrada.' : 'Nenhuma nota ainda.'}</p> : filtered.map(note => {
              const text = drafts[note.id] || note;
              return <button type="button" key={note.id} disabled={busy} onClick={() => setSelectedId(note.id)} aria-current={selectedId === note.id ? 'true' : undefined} className={`block w-full border-b border-slate-100 px-4 py-3 text-left ${selectedId === note.id ? 'bg-teal-50 border-l-2 border-l-teal-600' : 'hover:bg-slate-50'}`}><span className="block truncate text-sm font-semibold">{text.title || 'Sem título'}{drafts[note.id] ? ' *' : ''}</span><span className="mt-1 block truncate text-xs text-slate-500">{notePlainText(text.content) || 'Nota vazia'}</span><span className="mt-2 block text-[11px] text-slate-400">{new Date(note.updated_at).toLocaleDateString('pt-BR')}</span></button>;
            })}
          </div>
        </aside>
        {selected && draft ? <section className="flex min-w-0 flex-col p-4 sm:p-6">
          <div className="mb-3 flex justify-end">
            <button type="button" disabled={busy || loading || (!selected.task_id && !draft.title.trim() && !notePlainText(draft.content).trim())}
              onClick={() => {
                if (selected.task_id) void mutate(async () => {
                  try { await onViewTask(String(selected.task_id)); }
                  catch { setError('Não foi possível abrir a tarefa vinculada. Atualize as notas e tente novamente.'); }
                });
                else {
                  const converted = noteTaskContent(draft.content);
                  onCreateTask(selected.id, draft.title.trim() || 'Sem título', converted.description, converted.subtasks);
                }
              }} className="flex items-center gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50">
              <ListTodo size={16} /> {selected.task_id ? 'Ver tarefa' : 'Criar tarefa'}
            </button>
          </div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <span role="status" className="text-xs text-slate-500">{busy ? 'Salvando...' : dirty ? 'Rascunho neste navegador · salve para sincronizar' : 'Salvo na sua conta'}</span>
            <div className="flex gap-2"><button type="button" title="Excluir nota" aria-label="Excluir nota" disabled={busy || loading} onClick={remove} className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"><Trash2 size={17} /></button><button type="button" disabled={!dirty || busy || loading} onClick={() => void save()} className="flex items-center gap-2 rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save size={16} /> Salvar</button></div>
          </div>
          <input aria-label="Título da nota" placeholder="Sem título" maxLength={200} disabled={busy} value={draft.title} onChange={event => edit('title', event.target.value)} className="mb-4 w-full border-0 bg-transparent text-xl font-semibold outline-none" />
          <NoteEditor key={selected.id} value={draft.content} disabled={busy} onChange={content => edit('content', content)} onSave={() => { if (dirty && !busy && !loading) void save(); }} />
        </section> : <section className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center text-slate-400"><FileText size={32} strokeWidth={1.5} /><p className="text-sm">{notes.length ? 'Selecione uma nota' : 'Crie sua primeira nota'}</p></section>}
      </div>
    </main>
  );
}
