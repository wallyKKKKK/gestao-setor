'use client';

import { SortableTableHeader, useColumnSort } from '@/app/components/table-sort';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, RefreshCw, Trash2 } from 'lucide-react';
import { getAuthHeaders } from '@/lib/auth-headers';
import { deleteQuotationWorkspace } from '@/lib/purchase-quotation-draft';
import { quotationTimeZone } from '@/lib/purchase-quotation-summary';
import { quotationListPageSize, quotationNextStage, type QuotationRoundListItem } from '@/lib/purchase-quotation-workflow';

const formatDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: quotationTimeZone });
const button = 'inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 disabled:opacity-50';
const cell = 'px-3 py-2.5';
const roundStatus = (round: QuotationRoundListItem) => round.closedAt ? 'Finalizada' : round.published_at === null ? 'Rascunho' : round.pending ? 'Aguardando respostas' : round.responses ? 'Pronta para apurar' : 'Sem respostas';
const actions = { products: 'Continuar rascunho', tracking: 'Acompanhar', settlement: 'Apurar cotação', orders: 'Ver pedidos' };

export function PurchaseQuotationList({ disabled, onOpen, onDeleted }: {
  disabled?: boolean;
  onOpen: (round: QuotationRoundListItem) => void;
  onDeleted: (id: string) => void;
}) {
  const [result, setResult] = useState<{ rounds: QuotationRoundListItem[]; total: number; allPages: boolean } | null>(null);
  const rowSort = useColumnSort();
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const allPages = rowSort.rules.length > 0;
  const fetchPage = allPages ? 0 : page;

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      const headers = await getAuthHeaders();
      const readPage = async (index: number) => {
        const response = await fetch(`/api/purchase-quotation/settlement?page=${index}`, {
          headers, cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error('List unavailable');
        return await response.json() as { rounds: QuotationRoundListItem[]; total: number };
      };
      const first = await readPage(fetchPage);
      if (!allPages) return { ...first, allPages };
      const rounds = new Map(first.rounds.map(round => [round.id, round]));
      const pages = Math.ceil(first.total / quotationListPageSize);
      for (let start = 1; start < pages; start += 4) {
        const batch = await Promise.all(Array.from({ length: Math.min(4, pages - start) }, (_, index) => readPage(start + index)));
        for (const next of batch) for (const round of next.rounds) rounds.set(round.id, round);
      }
      return { rounds: Array.from(rounds.values()), total: rounds.size, allPages };
    };
    void load().then(data => {
      if (!controller.signal.aborted) setResult(data);
    }).catch(() => {
      if (!controller.signal.aborted) setError('Não foi possível carregar as cotações.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [allPages, fetchPage, reload]);

  const changePage = (next: number) => { if (!allPages) setLoading(true); setError(''); setPage(next); };
  const sortedRounds = rowSort.sortRowsBy(result?.rounds ?? [], round => ({
    Cotação: round.title, Prazo: round.deadline ? Date.parse(round.deadline) : '',
    Respostas: round.responses, Status: roundStatus(round),
  }));
  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / quotationListPageSize));
  const displayedRounds = result?.allPages ? sortedRounds.slice(page * quotationListPageSize, (page + 1) * quotationListPageSize) : sortedRounds;
  const sorting = Boolean(result && result.allPages !== allPages && !error);

  const remove = async (round: QuotationRoundListItem) => {
    if (deletingRef.current || !window.confirm(`Excluir a cotação ${round.draft_revision}: ${round.title}? Ela sairá da lista e do resumo, e os links enviados deixarão de funcionar.`)) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteQuotationWorkspace(round.id);
      setResult(current => current && { ...current, rounds: current.rounds.filter(item => item.id !== round.id), total: current.total - 1 });
      onDeleted(round.id);
      setLoading(true);
      if (displayedRounds.length === 1 && page > 0) setPage(page - 1);
      setReload(value => value + 1);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'Não foi possível excluir a cotação.');
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  return <section aria-labelledby="quotation-list-title" className="mx-auto w-full max-w-7xl">
    <header className="mb-2 flex items-center justify-between gap-2">
      <h2 id="quotation-list-title" className="text-lg font-bold text-slate-900">Minhas cotações</h2>
      <button type="button" className={button} title="Atualizar lista" aria-label="Atualizar lista de cotações" disabled={loading || deleting}
        onClick={() => { setLoading(true); setError(''); setReload(value => value + 1); }}><RefreshCw size={14} /></button>
    </header>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {deleteError && <p role="alert" className="text-sm text-red-700">{deleteError}</p>}
    {loading ? <p role="status" className="py-2 text-sm text-slate-600">Carregando cotações...</p> : !error && result && (result.rounds.length ? (
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="block w-full text-left text-xs sm:table sm:min-w-[38rem]">
          <thead className="hidden bg-slate-50 text-slate-700 sm:table-header-group"><tr>
            {['Cotação', 'Prazo', 'Respostas', 'Status', 'Próxima ação'].map(label => label === 'Próxima ação' ? <th key={label} scope="col" className={cell}>{label}</th> : <SortableTableHeader key={label} column={label} sort={rowSort} className={cell} />)}
          </tr></thead>
          <tbody className="block divide-y divide-slate-100 sm:table-row-group">
            {sorting && <tr><td colSpan={5} className={cell} role="status">Ordenando cotações...</td></tr>}
            {!sorting && displayedRounds.map(round => {
            const stage = quotationNextStage(round);
            const status = roundStatus(round);
            const tone = stage === 'tracking' || stage === 'products' ? 'bg-slate-100 text-slate-700' : 'bg-emerald-50 text-emerald-800';
            return <tr key={round.id} className="grid grid-cols-2 sm:table-row">
              <th scope="row" className={`${cell} col-span-2 min-w-0 break-words font-semibold text-slate-900 sm:max-w-xs`}>
                {round.title}<span className="mt-0.5 block font-normal text-slate-600">Cotação {round.draft_revision}</span>
              </th>
              <td className={cell}><span className="mr-1 text-slate-600 sm:hidden">Prazo:</span>{round.deadline ? formatDate.format(new Date(round.deadline)) : '—'}</td>
              <td className={`${cell} tabular-nums`}><span className="mr-1 text-slate-600 sm:hidden">Respostas:</span>{round.responses} de {round.participants}</td>
              <td className={cell}><span className={`inline-block rounded-md px-2 py-1 font-semibold ${tone}`}>{status}</span></td>
              <td className={`${cell} col-span-2`}><div className="flex flex-wrap gap-1.5">
                <button type="button" className={button} disabled={disabled || deleting} aria-label={`${actions[stage]}: ${round.title}, cotação ${round.draft_revision}`}
                  onClick={() => onOpen(round)}>{actions[stage]} <ArrowRight size={13} aria-hidden="true" /></button>
                <button type="button" className={`${button} text-red-700 hover:border-red-300 hover:bg-red-50`} disabled={disabled || deleting}
                  title="Excluir cotação" aria-label={`Excluir cotação ${round.draft_revision}: ${round.title}`} onClick={() => void remove(round)}>
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    ) : <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-600">Nenhuma cotação ainda.</p>)}
    {(page > 0 || totalPages > 1) && <nav aria-label="Paginação das cotações" className="mt-2 flex items-center justify-end gap-2 text-xs">
      <button type="button" className={button} disabled={loading || sorting || deleting || page === 0} onClick={() => changePage(page - 1)}>Anterior</button>
      <span>Página {page + 1} de {Math.max(page + 1, totalPages)}</span>
      <button type="button" className={button} disabled={loading || sorting || deleting || page + 1 >= totalPages} onClick={() => changePage(page + 1)}>Próxima</button>
    </nav>}
  </section>;
}
