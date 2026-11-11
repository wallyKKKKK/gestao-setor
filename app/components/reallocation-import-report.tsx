'use client';

import { SortableTableHeader, useColumnSort } from '@/app/components/table-sort';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Download, Search, X } from 'lucide-react';
import type { ReallocationImportFilterSelection, ReallocationImportReport } from '@/lib/reallocation-import-report';
import { ReallocationImportFilterPreview, type CurrentImportFilters } from './reallocation-import-filter-preview';

const PAGE_SIZE = 50;
const format = (value: number) => value.toLocaleString('pt-BR');

export function ReallocationImportReportDialog({ report, onClose, currentFilters, onApplyFilters }: { report: ReallocationImportReport; onClose: () => void; currentFilters?: CurrentImportFilters; onApplyFilters?: (selection: ReallocationImportFilterSelection) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const hasFilterPreview = report.imported > 0 && Boolean(report.filterPreview && currentFilters && onApplyFilters);
  const [tab, setTab] = useState<'summary' | 'filters' | 'unmatched' | 'skipped'>(hasFilterPreview ? 'filters' : 'summary');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const rows = tab === 'unmatched' ? report.unmatchedItems : report.skippedRows;
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return term ? rows.filter((row) => [row.line, row.storeCode, row.storeName, row.ean, row.product, row.reason].join(' ').toLocaleLowerCase('pt-BR').includes(term)) : rows;
  }, [rows, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const rowSort = useColumnSort();
  const sorted = rowSort.sortRowsBy(filtered, row => ({ Linha: row.line, Loja: `${row.storeCode} ${row.storeName}`, EAN: row.ean, Produto: row.product, Motivo: row.reason }));
  const visible = sorted.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const download = () => {
    const escape = (value: unknown) => {
      const text = String(value ?? '');
      const safe = /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const values = [
      ['Tipo', 'Linha', 'Loja', 'Nome loja', 'EAN', 'Produto', 'Motivo'],
      ...report.unmatchedItems.map((row) => ['Sem vinculo', row.line, row.storeCode, row.storeName, row.ean, row.product, row.reason]),
      ...report.skippedRows.map((row) => ['Ignorada', row.line, row.storeCode, row.storeName, row.ean, row.product, row.reason]),
    ];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + values.map((row) => row.map(escape).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pendencias-importacao.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <dialog ref={dialogRef} onCancel={onClose} aria-labelledby="import-report-title" className="m-auto w-[calc(100%_-_24px)] max-w-[1100px] max-h-[90dvh] overflow-hidden rounded-lg border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/30">
      <div className="flex h-[min(calc(90dvh_-_2px),50rem)] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 id="import-report-title" className="flex items-center gap-2 text-base font-black"><Check size={20} className="shrink-0 text-violet-600" /> {report.imported > 0 ? 'Importacao concluida' : 'Nenhuma linha importada'}</h2>
            <p className="mt-1 break-words text-xs text-slate-500">{report.sourceFile} · {report.sector}</p>
          </div>
          <button type="button" onClick={onClose} autoFocus aria-label="Fechar resumo da importacao" title="Fechar" className="rounded-md p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-violet-600"><X size={20} /></button>
        </header>
        <div className="flex shrink-0 flex-wrap gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3" role="group" aria-label="Abas da importação">
          <button type="button" aria-pressed={tab === 'summary'} onClick={() => setTab('summary')} className={`rounded-md px-3 py-2 text-xs font-bold ${tab === 'summary' ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 hover:bg-violet-50'}`}>Resumo</button>
          {hasFilterPreview && <button type="button" aria-pressed={tab === 'filters'} onClick={() => setTab('filters')} className={`rounded-md px-3 py-2 text-xs font-bold ${tab === 'filters' ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 hover:bg-violet-50'}`}>Prévia dos filtros</button>}
          {([{ id: 'unmatched', label: 'Itens sem vínculo', count: report.unmatchedItems.length }, { id: 'skipped', label: 'Linhas ignoradas', count: report.skippedRows.length }] as const).map((option) => (
            <button type="button" key={option.id} aria-pressed={tab === option.id} onClick={() => { setTab(option.id); setSearch(''); setPage(0); }} className={`rounded-md px-3 py-2 text-xs font-bold ${tab === option.id ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 hover:bg-violet-50'}`}>{option.label} ({format(option.count)})</button>
          ))}
        </div>
        <div className={`min-h-0 flex-1 ${tab === 'filters' ? 'overflow-hidden' : 'overflow-auto'}`}>
          {tab === 'summary' && <>
          <section aria-label="Resumo da importacao" className="grid grid-cols-2 gap-3 border-b border-slate-200 px-5 py-5 sm:grid-cols-4">
            {[
              ['Linhas importadas', report.imported], ['Com vinculo ERP', report.matchedProducts],
              ['Sem vinculo', report.unmatchedProducts], ['Linhas ignoradas', report.skipped],
            ].map(([label, value]) => (
              <div key={label} className="border-l-2 border-violet-300 pl-3"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-2xl font-black text-violet-700">{format(Number(value))}</p></div>
            ))}
          </section>
          <div className="space-y-4 px-5 py-5 text-sm text-slate-600">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {([['Linhas lidas', report.totalRows], ['EANs únicos', report.uniqueProducts], ['Registros anteriores removidos', report.replacedRows]] as const).map(([label, value]) => (
                <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="font-semibold tabular-nums text-slate-900">{format(value)}</dd></div>
              ))}
            </dl>
            <p>{report.imported > 0 ? 'A base do setor foi substituida integralmente.' : 'A base anterior foi preservada.'} A media diaria usa a venda mensal dividida por 30.</p>
            {report.unmatchedProducts > 0 && <p className="text-amber-700">Itens sem vinculo foram importados, mas precisam de codigo ERP para exportar transferencias.</p>}
            {!report.movementColumnsAvailable && <p role="status" className="text-amber-700">Alguns campos adicionais nao foram salvos. Atualize a estrutura de estoque no banco.</p>}
            {report.erpInventoryWarning && <p role="status" className="break-words text-amber-700">Remanejamento atualizado, mas o espelhamento no estoque ERP falhou: {report.erpInventoryWarning}</p>}
            <section aria-label="Lojas importadas">
              <h3 className="mb-2 font-bold text-slate-900">Lojas importadas ({format(report.stores.length)})</h3>
              {report.stores.length ? <ul className="grid gap-x-4 rounded-md border border-slate-200 px-3 sm:grid-cols-2 lg:grid-cols-3">
                {report.stores.map((store) => <li key={store.code} className="flex min-w-0 gap-2 border-b border-slate-100 py-2"><span className="shrink-0 font-semibold tabular-nums text-violet-700">{store.code}</span><span className="min-w-0 break-words">{store.name}</span></li>)}
              </ul> : <p>Nenhuma loja importada.</p>}
            </section>
          </div>
          </>}
          {hasFilterPreview && currentFilters && onApplyFilters && <div hidden={tab !== 'filters'} className="h-full"><ReallocationImportFilterPreview report={report} current={currentFilters} onApply={onApplyFilters} onDiscard={onClose} /></div>}
          {(tab === 'unmatched' || tab === 'skipped') && <div className="flex h-full min-h-0 flex-col">
          <div className="px-5 py-3">
            <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-slate-400"><Search size={16} /><input aria-label="Pesquisar pendencias" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Buscar por loja, EAN, produto ou motivo..." className="min-w-0 flex-1 bg-transparent text-xs text-slate-900 outline-none" /></label>
          </div>
          <div id="import-report-rows" className="min-h-0 flex-1 overflow-auto border-y border-slate-200">
            {visible.length ? <table className="w-full min-w-[720px] border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['Linha', 'Loja', 'EAN', 'Produto', 'Motivo'].map((label) => <SortableTableHeader key={label} column={label} sort={rowSort} className={"px-4 py-3 font-bold"} />)}</tr></thead>
              <tbody>{visible.map((row) => <tr key={row.line} className="border-t border-slate-100 even:bg-slate-50/60"><td className="px-4 py-3">{row.line}</td><td className="px-4 py-3">{[row.storeCode, row.storeName].filter(Boolean).join(' - ') || '-'}</td><td className="px-4 py-3">{row.ean || '-'}</td><td className="max-w-80 break-words px-4 py-3 font-semibold">{row.product || '-'}</td><td className="max-w-72 break-words px-4 py-3 text-slate-500">{row.reason}</td></tr>)}</tbody>
            </table> : <p className="flex h-full items-center justify-center px-5 py-4 text-center text-sm text-slate-500">{search ? 'Nenhum resultado para a busca.' : tab === 'unmatched' ? 'Nenhum item sem vínculo ERP.' : 'Nenhuma linha ignorada.'}</p>}
          </div>
          <div className="flex items-center justify-between gap-2 px-5 py-3 text-xs text-slate-500">
            <span>{format(filtered.length)} registros · Pagina {currentPage + 1} de {pages}</span>
            <div className="flex gap-2"><button type="button" title="Pagina anterior" aria-label="Pagina anterior" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="rounded-md border p-2 disabled:opacity-30"><ChevronLeft size={16} /></button><button type="button" title="Proxima pagina" aria-label="Proxima pagina" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)} className="rounded-md border p-2 disabled:opacity-30"><ChevronRight size={16} /></button></div>
          </div>
          </div>}
        </div>
        {tab !== 'filters' && <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" disabled={!report.unmatchedItems.length && !report.skippedRows.length} onClick={download} className="flex items-center gap-2 rounded-md border border-violet-200 px-3 py-2 text-xs font-bold text-violet-700 disabled:opacity-40"><Download size={15} /> Exportar pendencias</button>
          <button type="button" onClick={onClose} className="rounded-md bg-violet-600 px-5 py-2 text-xs font-bold text-white hover:bg-violet-700">Fechar</button>
        </footer>}
      </div>
    </dialog>
  );
}
