'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { SortableGridHeader, useColumnSort } from '@/app/components/table-sort';
import type { ReallocationImportFilterSelection, ReallocationImportReport } from '@/lib/reallocation-import-report';
import { initialImportFilterSelection, normalizeImportStoreCode } from '@/lib/reallocation-import-filters';

export interface CurrentImportFilters {
  manufacturers: string[]; origins: string[]; destinations: string[]; otherCount: number;
}

export function ReallocationImportFilterPreview({ report, current, onApply, onDiscard }: {
  report: ReallocationImportReport; current: CurrentImportFilters; onApply: (selection: ReallocationImportFilterSelection) => void; onDiscard: () => void;
}) {
  const [selection, setSelection] = useState(() => initialImportFilterSelection(report, current.destinations));
  const [manufacturerSearch, setManufacturerSearch] = useState('');
  const [storeSearch, setStoreSearch] = useState('');
  const storeSort = useColumnSort();
  const manufacturers = report.filterPreview?.manufacturers || [];
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const visibleManufacturers = manufacturers.filter(item => normalize(item.name).includes(normalize(manufacturerSearch)));
  const stores = report.stores.map(store => {
    const code = normalizeImportStoreCode(store.code);
    return { ...store, code, columns: [code, store.name] };
  });
  const visibleStores = storeSort.sortRows(stores.filter(store => normalize(`${store.code} ${store.name}`).includes(normalize(storeSearch))),
    (store, key) => key === 'code' ? store.code : key === 'name' ? store.name
      : Number(selection[key === 'origin' ? 'origins' : 'destinations'].includes(store.code)));
  const outsideStores = [...new Set([...current.origins, ...current.destinations].map(normalizeImportStoreCode))].filter(code => !stores.some(store => store.code === code));
  const outsideManufacturers = current.manufacturers.filter(name => !manufacturers.some(item => normalize(item.name) === normalize(name)));
  const toggle = (field: 'manufacturers' | 'origins' | 'destinations', value: string) => setSelection(current => ({ ...current, [field]: current[field].includes(value) ? current[field].filter(item => item !== value) : [...current[field], value] }));
  const toggleAll = (field: 'manufacturers' | 'origins', values: string[]) => setSelection(current => ({ ...current, [field]: values.every(value => current[field].includes(value)) ? current[field].filter(value => !values.includes(value)) : [...new Set([...current[field], ...values])] }));
  return <section aria-label="Prévia dos filtros da importação" className="flex h-full flex-col">
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-3">
    {outsideStores.length + outsideManufacturers.length > 0 && <p role="status" className="shrink-0 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">{outsideStores.length + outsideManufacturers.length} filtros fora do arquivo serão substituídos ao aplicar.</p>}
    <div className="grid min-h-0 flex-1 grid-rows-2 gap-3 md:grid-cols-2 md:grid-rows-1">
      <div className="flex min-h-0 min-w-0 flex-col gap-1"><h3 className="shrink-0 text-sm font-bold text-violet-700">Fabricantes · {selection.manufacturers.length} selecionados</h3>
        <label className="flex shrink-0 items-center gap-2 rounded-md border border-slate-200 px-2"><Search size={14} className="text-slate-400" /><input aria-label="Pesquisar fabricantes da importação" value={manufacturerSearch} onChange={event => setManufacturerSearch(event.target.value)} placeholder="Pesquisar fabricante..." className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none" /></label>
        <button type="button" onClick={() => toggleAll('manufacturers', visibleManufacturers.filter(item => item.linked).map(item => item.name))} className="shrink-0 self-start text-xs font-semibold text-violet-700">Marcar / desmarcar vinculados</button>
        <div className="min-h-0 flex-1 space-y-1 overflow-auto rounded-md border border-slate-200 p-2">{visibleManufacturers.map(item => <label key={item.name} className="flex items-start gap-2 rounded px-1 py-2 hover:bg-violet-50"><input type="checkbox" checked={selection.manufacturers.includes(item.name)} onChange={() => toggle('manufacturers', item.name)} className="mt-0.5 accent-violet-600" /><span className="min-w-0 text-xs"><span className="block break-words font-semibold">{item.name}</span><span className={item.linked ? 'text-slate-500' : 'text-amber-700'}>{item.source === 'file' ? 'Informado no arquivo' : 'Identificado pelo EAN na base'}{!item.linked ? ' · sem vínculo ERP' : ''}</span></span></label>)}{!visibleManufacturers.length && <p className="p-3 text-xs text-slate-500">Nenhum fabricante identificado.</p>}</div>
        {report.filterPreview?.missingManufacturerRows ? <p className="shrink-0 text-xs text-amber-700">{report.filterPreview.missingManufacturerRows} linhas sem fabricante.</p> : null}
      </div>
      <div className="flex min-h-0 min-w-0 flex-col gap-1"><h3 className="shrink-0 text-sm font-bold text-violet-700">Lojas · {selection.origins.length} origens / {selection.destinations.length} destinos</h3>
        <label className="flex shrink-0 items-center gap-2 rounded-md border border-slate-200 px-2"><Search size={14} className="text-slate-400" /><input aria-label="Pesquisar lojas da importação" value={storeSearch} onChange={event => setStoreSearch(event.target.value)} placeholder="Pesquisar loja..." className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none" /></label>
        <button type="button" onClick={() => toggleAll('origins', visibleStores.map(store => store.code))} className="shrink-0 self-start text-xs font-semibold text-violet-700">Marcar / desmarcar origens</button>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-200">
          <div className="sticky top-0 grid grid-cols-[56px_minmax(0,1fr)_56px_56px] items-center gap-1 border-b bg-slate-50 px-2 py-2 text-xs font-bold">
            {([['code', 'Código'], ['name', 'Loja'], ['origin', 'Origem'], ['destination', 'Destino']] as const).map(([key, label]) =>
              <SortableGridHeader key={key} sort={storeSort} column={key} label={label} className="flex min-w-0 select-none items-center gap-0.5 text-left hover:text-violet-700" />)}
          </div>
          {visibleStores.map(store => (
            <div key={store.code} className="grid grid-cols-[56px_minmax(0,1fr)_56px_56px] items-center gap-1 border-b border-slate-100 px-2 py-2 text-sm last:border-0">
              <span className="break-words tabular-nums">{store.code}</span>
              <span className="min-w-0 break-words">{store.name}</span>
              {(['origins', 'destinations'] as const).map(field => <input key={field} type="checkbox" aria-label={`${field === 'origins' ? 'Origem' : 'Destino'} ${store.code} ${store.name}`} checked={selection[field].includes(store.code)} onChange={() => toggle(field, store.code)} className="size-4 justify-self-center accent-violet-600" />)}
            </div>
          ))}
        </div>
        {!selection.destinations.length && <p className="shrink-0 text-xs text-slate-500">Sem seleção de destino, vale o perfil.</p>}
      </div>
    </div>
    {current.otherCount > 0 && <label className="flex shrink-0 items-start gap-2 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700"><input type="checkbox" checked={selection.clearOtherFilters} onChange={event => setSelection(current => ({ ...current, clearOtherFilters: event.target.checked }))} className="mt-0.5 accent-violet-600" /><span>Limpar outros {current.otherCount} filtros (sem alterar o perfil).</span></label>}
    {!selection.origins.length && <p role="alert" className="text-xs text-amber-700">Selecione pelo menos uma loja de origem.</p>}
    </div>
    <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3"><button type="button" onClick={onDiscard} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Continuar sem preencher</button><button type="button" disabled={!selection.origins.length} onClick={() => onApply(selection)} className="rounded-md bg-violet-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">Aplicar filtros</button></footer>
  </section>;
}
