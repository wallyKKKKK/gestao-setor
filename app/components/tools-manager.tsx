'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Archive, Download, FileArchive, Info, LoaderCircle, Pencil, Plus, RefreshCw, RotateCcw, Search, Wrench, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatToolSize, TOOL_COLUMNS, TOOL_FILE_ACCEPT, TOOLS_BUCKET, toolPublishError, toolStorageName, validateToolFile, type DownloadableTool } from '@/lib/tool-downloads';

type ToolForm = { id?: string; publishId: string; name: string; description: string; version: string; file: File | null };
const emptyForm = (): ToolForm => ({ publishId: crypto.randomUUID(), name: '', description: '', version: '', file: null });

export function ToolsManager({ userId, canManage }: { userId: string; canManage: boolean }) {
  const [tools, setTools] = useState<DownloadableTool[]>([]);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<ToolForm | null>(null);
  const [formError, setFormError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true);
  const mutationLock = useRef(false);
  const downloadLock = useRef(false);
  const request = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current += 1; };
  }, []);

  const load = useCallback(async () => {
    if (mutationLock.current) return;
    const sequence = ++request.current;
    setLoading(true);
    setError('');
    try {
      const { data, error } = await supabase.from('app_tools').select(TOOL_COLUMNS).order('name');
      if (error) throw error;
      if (mounted.current && sequence === request.current) setTools((data || []) as DownloadableTool[]);
    } catch {
      if (mounted.current && sequence === request.current) setError('Não foi possível carregar as ferramentas. Tente atualizar.');
    } finally {
      if (mounted.current && sequence === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => { queueMicrotask(() => { if (mounted.current) void load(); }); }, [load]);
  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener('wally:app-refresh', refresh);
    return () => window.removeEventListener('wally:app-refresh', refresh);
  }, [load]);
  useEffect(() => { if (form) dialog.current?.showModal(); }, [form]);

  const openForm = (tool?: DownloadableTool) => {
    if (!canManage || mutationLock.current) return;
    setForm(tool ? { id: tool.id, publishId: tool.id, name: tool.name, description: tool.description, version: tool.version, file: null } : emptyForm());
    setFormError('');
  };

  const publish = async (event: FormEvent) => {
    event.preventDefault();
    if (!form || !canManage || mutationLock.current) return;
    const snapshot = form;
    if (!snapshot.name.trim()) { setFormError('Informe o nome da ferramenta.'); return; }
    if (!snapshot.id && !snapshot.file) { setFormError('Selecione o arquivo para download.'); return; }
    if (snapshot.file) {
      const validation = validateToolFile(snapshot.file);
      if (validation) { setFormError(validation); return; }
    }
    mutationLock.current = true;
    request.current += 1;
    setSaving(true);
    setLoading(false);
    setFormError('');
    setError('');
    setMessage('');
    let uploadedPath = '';
    let committed = false;
    let stage: 'upload' | 'database' = 'upload';
    try {
      if (snapshot.file) {
        const path = `${userId}/${crypto.randomUUID()}/${toolStorageName(snapshot.file.name)}`;
        // The SDK sends Blob.type in multipart uploads, not the contentType option.
        const uploadBody = snapshot.file.slice(0, snapshot.file.size, 'application/octet-stream');
        const { error } = await supabase.storage.from(TOOLS_BUCKET).upload(path, uploadBody, { upsert: false, contentType: 'application/octet-stream', cacheControl: '60' });
        if (error) throw error;
        uploadedPath = path;
      }
      stage = 'database';
      const values = {
        name: snapshot.name.trim(), description: snapshot.description.trim(), version: snapshot.version.trim(),
        updated_at: new Date().toISOString(),
        ...(snapshot.file ? { file_name: snapshot.file.name, file_path: uploadedPath, file_size: snapshot.file.size } : {}),
      };
      const operation = snapshot.id
        ? supabase.from('app_tools').update(values).eq('id', snapshot.id)
        : supabase.from('app_tools').insert({ ...values, id: snapshot.publishId, created_by: userId });
      const { data, error } = await operation.select(TOOL_COLUMNS).single();
      if (error || !data) throw error || new Error('Ferramenta não encontrada');
      committed = true;
      if (!mounted.current) return;
      setTools(current => [data as DownloadableTool, ...current.filter(item => item.id !== data.id)].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
      setForm(null);
      setMessage(snapshot.id ? 'Ferramenta atualizada.' : 'Ferramenta publicada para download.');
    } catch (publishError) {
      // Keep an uncertain upload for recovery; only remove a file known not to be published.
      let cleanupFailed = false;
      if (uploadedPath && !committed) {
        try {
          const { data: published, error: lookupError } = await supabase.from('app_tools').select('id').eq('file_path', uploadedPath).maybeSingle();
          cleanupFailed = Boolean(lookupError);
          if (!lookupError && !published) {
            const { error: cleanupError } = await supabase.storage.from(TOOLS_BUCKET).remove([uploadedPath]);
            cleanupFailed = Boolean(cleanupError);
          }
        } catch { cleanupFailed = true; }
      }
      if (mounted.current) setFormError(`${toolPublishError(publishError, stage)}${cleanupFailed ? ' O arquivo enviado ficou pendente no armazenamento; avise um administrador.' : ''}`);
    } finally {
      mutationLock.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const toggleActive = async (tool: DownloadableTool) => {
    if (!canManage || mutationLock.current) return;
    mutationLock.current = true;
    request.current += 1;
    setSaving(true);
    setLoading(false);
    setError('');
    setMessage('');
    try {
      const { data, error } = await supabase.from('app_tools').update({ is_active: !tool.is_active, updated_at: new Date().toISOString() }).eq('id', tool.id).select(TOOL_COLUMNS).single();
      if (error || !data) throw error || new Error('Ferramenta não encontrada');
      if (mounted.current) {
        setTools(current => current.map(item => item.id === tool.id ? data as DownloadableTool : item));
        setMessage(tool.is_active ? 'Ferramenta retirada dos downloads. Você pode restaurá-la em Arquivadas.' : 'Ferramenta disponível novamente.');
      }
    } catch {
      if (mounted.current) setError('Não foi possível alterar a disponibilidade. Tente novamente.');
    } finally {
      mutationLock.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const download = async (tool: DownloadableTool) => {
    if (downloadLock.current || !tool.is_active) return;
    downloadLock.current = true;
    setDownloading(tool.id);
    setError('');
    try {
      const { data, error } = await supabase.storage.from(TOOLS_BUCKET).createSignedUrl(tool.file_path, 60, { download: tool.file_name });
      if (error || !data?.signedUrl) throw error || new Error('Download indisponível');
      if (!mounted.current) return;
      const link = document.createElement('a');
      link.href = data.signedUrl;
      link.download = tool.file_name;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      if (mounted.current) setError('Não foi possível iniciar o download. Atualize a lista e tente novamente.');
    } finally {
      downloadLock.current = false;
      if (mounted.current) setDownloading('');
    }
  };

  const search = query.toLocaleLowerCase('pt-BR');
  const filtered = tools.filter(tool => (tool.is_active || (canManage && showArchived)) && `${tool.name} ${tool.description} ${tool.version} ${tool.file_name}`.toLocaleLowerCase('pt-BR').includes(search));
  const iconButton = 'rounded-md border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50';
  const inputClass = 'w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100';

  return <main className="mx-auto max-w-[1500px] p-3 sm:p-5">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-lg font-semibold">Ferramentas <span className="ml-2 text-sm font-normal text-slate-500">{tools.filter(tool => tool.is_active).length}</span></h1>
      <div className="flex items-center gap-2">
        <button type="button" title="Atualizar ferramentas" aria-label="Atualizar ferramentas" onClick={() => void load()} disabled={loading || saving} className={iconButton}><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button>
        {canManage && <button type="button" onClick={() => openForm()} disabled={saving} className="flex items-center gap-2 rounded-md bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Plus size={17} /> Adicionar ferramenta</button>}
      </div>
    </div>
    <aside role="note" aria-label="Aviso de segurança dos aplicativos" className="mb-4 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <Info size={19} className="mt-0.5 shrink-0 text-cyan-700" aria-hidden="true" />
      <div className="min-w-0 text-sm font-bold leading-relaxed text-slate-600">
        <h2 className="font-bold text-slate-900">Aplicativos de uso interno</h2>
        <p>Conforme informado pela administração, os aplicativos disponibilizados aqui foram testados previamente.</p>
        <p className="mt-1">Se o Windows ou antivírus exibir um alerta ou bloquear a execução, confirme o arquivo e a versão com a administração antes de prosseguir. Testes prévios não garantem ausência de riscos; não desative as proteções do computador.</p>
      </div>
    </aside>
    <div className="mb-4 flex flex-wrap items-center gap-4">
      <div className="relative w-full sm:w-80"><Search size={16} className="absolute left-3 top-3 text-slate-400" /><input aria-label="Buscar ferramentas" placeholder="Buscar ferramentas..." value={query} onChange={event => setQuery(event.target.value)} className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm" /></div>
      {canManage && <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} className="accent-cyan-700" /> Mostrar arquivadas</label>}
    </div>
    {error && <p role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="mb-3 text-sm text-emerald-700">{message}</p>}
    {loading && !tools.length ? <p role="status" className="py-10 text-center text-sm text-slate-500">Carregando ferramentas...</p>
      : !filtered.length ? <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-300 py-16 text-slate-500"><Wrench size={30} strokeWidth={1.5} /><p className="text-sm">{query ? 'Nenhuma ferramenta encontrada.' : 'Nenhuma ferramenta disponível.'}</p></div>
      : <div className="space-y-2">{filtered.map(tool => <article key={tool.id} className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="rounded-md bg-cyan-50 p-2 text-cyan-700"><FileArchive size={23} /></span>
          <div className="min-w-0">
            <h2 className="break-words text-base font-semibold">{tool.name} {!tool.is_active && <span className="ml-2 text-xs font-normal text-slate-500">Arquivada</span>}</h2>
            {tool.description && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{tool.description}</p>}
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500"><span>{tool.version ? `Versão ${tool.version}` : 'Sem versão informada'}</span><span>{formatToolSize(tool.file_size)}</span><span>Atualizado em {new Date(tool.updated_at).toLocaleDateString('pt-BR')}</span></p>
            <p className="mt-1 break-all text-xs text-slate-400">{tool.file_name}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
          {canManage && <><button type="button" title={`Editar ${tool.name}`} aria-label={`Editar ${tool.name}`} disabled={saving} onClick={() => openForm(tool)} className={iconButton}><Pencil size={16} /></button><button type="button" title={tool.is_active ? 'Retirar dos downloads' : 'Restaurar ferramenta'} aria-label={tool.is_active ? `Arquivar ${tool.name}` : `Restaurar ${tool.name}`} disabled={saving} onClick={() => void toggleActive(tool)} className={iconButton}>{tool.is_active ? <Archive size={16} /> : <RotateCcw size={16} />}</button></>}
          <button type="button" disabled={!tool.is_active || Boolean(downloading) || saving} onClick={() => void download(tool)} className="flex items-center gap-2 rounded-md bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-50">{downloading === tool.id ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />} Baixar</button>
        </div>
      </article>)}</div>}
    {form && <dialog ref={dialog} aria-labelledby="tool-form-title" onCancel={event => { if (saving) event.preventDefault(); else setForm(null); }} onClose={() => { if (!mutationLock.current) setForm(null); }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100vw-24px)] max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/40">
      <form onSubmit={event => void publish(event)}>
        <div className="flex items-center justify-between border-b border-slate-200 p-4"><h2 id="tool-form-title" className="font-semibold">{form.id ? 'Editar ferramenta' : 'Adicionar ferramenta'}</h2><button type="button" disabled={saving} aria-label="Fechar formulário" onClick={() => setForm(null)} className="rounded p-1 hover:bg-slate-100"><X size={19} /></button></div>
        <fieldset disabled={saving} className="space-y-4 p-4">
          {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
          <label className="block text-sm font-medium">Nome<input autoFocus required maxLength={120} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className={`mt-1 ${inputClass}`} /></label>
          <label className="block text-sm font-medium">Descrição<textarea maxLength={2000} rows={3} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} className={`mt-1 resize-y ${inputClass}`} /></label>
          <label className="block text-sm font-medium">Versão<input maxLength={40} placeholder="Ex.: 1.0.0" value={form.version} onChange={event => setForm({ ...form, version: event.target.value })} className={`mt-1 ${inputClass}`} /></label>
          <label className="block text-sm font-medium">{form.id ? 'Substituir arquivo (opcional)' : 'Arquivo'}<input type="file" accept={TOOL_FILE_ACCEPT} required={!form.id} onChange={event => setForm({ ...form, file: event.target.files?.[0] || null })} className={`mt-1 ${inputClass}`} /><span className="mt-1 block text-xs font-normal text-slate-500">EXE, MSI ou ZIP · até 50 MB</span></label>
          <p className="text-xs text-slate-500">Antes de publicar, teste o aplicativo e confira sua origem e versão. O download não executa nem instala o arquivo.</p>
        </fieldset>
        <div className="flex justify-end gap-2 border-t border-slate-200 p-4"><button type="button" disabled={saving} onClick={() => setForm(null)} className="rounded-md border border-slate-200 px-3 py-2 text-sm">Cancelar</button><button type="submit" disabled={saving} className="flex items-center gap-2 rounded-md bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving && <LoaderCircle size={16} className="animate-spin" />}{saving ? 'Enviando...' : form.id ? 'Salvar alterações' : 'Publicar'}</button></div>
      </form>
    </dialog>}
  </main>;
}
