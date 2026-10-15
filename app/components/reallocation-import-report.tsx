'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Download, Search, X } from 'lucide-react';
import type { ReallocationImportReport } from '@/lib/reallocation-import-report';

const PAGE_SIZE = 50;
const format = (value: number) => value.toLocaleString('pt-BR');

export function ReallocationImportReportDialog({ report, onClose }: { report: ReallocationImportReport; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'unmatched' | 'skipped'>(report.unmatchedItems.length ? 'unmatched' : 'skipped');
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
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

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
      <div className="flex max-h-[90dvh] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 id="import-report-title" className="flex items-center gap-2 text-base font-black"><Check size={20} className="shrink-0 text-violet-600" /> {report.imported > 0 ? 'Importacao concluida' : 'Nenhuma linha importada'}</h2>
            <p className="mt-1 break-words text-xs text-slate-500">{report.sourceFile} · {report.sector}</p>
          </div>
          <button type="button" onClick={onClose} autoFocus aria-label="Fechar resumo da importacao" title="Fechar" className="rounded-md p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-violet-600"><X size={20} /></button>
        </header>
        <div className="min-h-0 overflow-auto">
          <section aria-label="Resumo da importacao" className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-4">
            {[
              ['Linhas importadas', report.imported], ['Com vinculo ERP', report.matchedProducts],
              ['Sem vinculo', report.unmatchedProducts], ['Linhas ignoradas', report.skipped],
            ].map(([label, value]) => (
              <div key={label} className="border-l-2 border-violet-300 pl-3"><p className="text-[11px] font-bold uppercase text-slate-500">{label}</p><p className="mt-1 text-xl font-black text-violet-700">{format(Number(value))}</p></div>
            ))}
          </section>
          <div className="space-y-2 px-5 pb-4 text-xs text-slate-600">
            <p>{format(report.totalRows)} linhas lidas · {format(report.uniqueProducts)} EANs · {format(report.stores.length)} lojas · {format(report.replacedRows)} registros anteriores removidos</p>
            <p className="break-words"><strong>Lojas:</strong> {report.stores.map((store) => `${store.code} - ${store.name}`).join(', ')}</p>
            <p>{report.imported > 0 ? 'A base do setor foi substituida integralmente.' : 'A base anterior foi preservada.'} A media diaria usa a venda mensal dividida por 30.</p>
            {report.unmatchedProducts > 0 && <p className="text-amber-700">Itens sem vinculo foram importados, mas precisam de codigo ERP para exportar transferencias.</p>}
            {!report.movementColumnsAvailable && <p role="status" className="text-amber-700">Alguns campos adicionais nao foram salvos. Atualize a estrutura de estoque no banco.</p>}
            {report.erpInventoryWarning && <p role="status" className="break-words text-amber-700">Remanejamento atualizado, mas o espelhamento no estoque ERP falhou: {report.erpInventoryWarning}</p>}
          </div>
          <div className="flex flex-wrap gap-2 border-y border-slate-200 bg-slate-50 px-5 py-3" role="group" aria-label="Pendencias da importacao">
            {([{ id: 'unmatched', label: 'Itens sem vinculo', count: report.unmatchedItems.length }, { id: 'skipped', label: 'Linhas ignoradas', count: report.skippedRows.length }] as const).map((option) => (
              <button type="button" key={option.id} aria-pressed={tab === option.id} aria-controls="import-report-rows" onClick={() => { setTab(option.id); setSearch(''); setPage(0); }} className={`rounded-md px-3 py-2 text-xs font-bold ${tab === option.id ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 hover:bg-violet-50'}`}>{option.label} ({format(option.count)})</button>
            ))}
          </div>
          <div className="px-5 py-3">
            <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-slate-400"><Search size={16} /><input aria-label="Pesquisar pendencias" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Buscar por loja, EAN, produto ou motivo..." className="min-w-0 flex-1 bg-transparent text-xs text-slate-900 outline-none" /></label>
          </div>
          <div id="import-report-rows" className="max-h-[36dvh] overflow-auto border-y border-slate-200">
            <table className="w-full min-w-[720px] border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['Linha', 'Loja', 'EAN', 'Produto', 'Motivo'].map((label) => <th key={label} className="px-4 py-3 font-bold">{label}</th>)}</tr></thead>
              <tbody>{visible.map((row) => <tr key={row.line} className="border-t border-slate-100 even:bg-slate-50/60"><td className="px-4 py-3">{row.line}</td><td className="px-4 py-3">{[row.storeCode, row.storeName].filter(Boolean).join(' - ') || '-'}</td><td className="px-4 py-3">{row.ean || '-'}</td><td className="max-w-80 break-words px-4 py-3 font-semibold">{row.product || '-'}</td><td className="max-w-72 break-words px-4 py-3 text-slate-500">{row.reason}</td></tr>)}</tbody>
            </table>
            {!visible.length && <p className="px-5 py-10 text-center text-sm text-slate-500">{search ? 'Nenhum resultado para a busca.' : tab === 'unmatched' ? 'Todos os itens importados possuem vinculo ERP.' : 'Nenhuma linha ignorada.'}</p>}
          </div>
          <div className="flex items-center justify-between gap-2 px-5 py-3 text-xs text-slate-500">
            <span>{format(filtered.length)} registros · Pagina {currentPage + 1} de {pages}</span>
            <div className="flex gap-2"><button type="button" title="Pagina anterior" aria-label="Pagina anterior" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="rounded-md border p-2 disabled:opacity-30"><ChevronLeft size={16} /></button><button type="button" title="Proxima pagina" aria-label="Proxima pagina" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)} className="rounded-md border p-2 disabled:opacity-30"><ChevronRight size={16} /></button></div>
          </div>
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" disabled={!report.unmatchedItems.length && !report.skippedRows.length} onClick={download} className="flex items-center gap-2 rounded-md border border-violet-200 px-3 py-2 text-xs font-bold text-violet-700 disabled:opacity-40"><Download size={15} /> Exportar pendencias</button>
          <button type="button" onClick={onClose} className="rounded-md bg-violet-600 px-5 py-2 text-xs font-bold text-white hover:bg-violet-700">Fechar</button>
        </footer>
      </div>
    </dialog>
  );
}
