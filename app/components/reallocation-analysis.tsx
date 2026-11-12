'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { SortableTableHeader, useColumnSort } from '@/app/components/table-sort';
import { getReallocationDestinationCoverage, getReallocationSplitDestinations, type ReallocationNeedsReport } from '@/lib/reallocation-needs';
import { hasAutomaticSplit } from '@/lib/reallocation-row-markers';

const units = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const days = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const percentage = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 });
const format = (value?: number) => value == null ? '–' : units.format(value);
const reasonLabels = {
  'no-surplus': 'Nenhuma origem elegível com sobra',
  route: 'Sem rota permitida para a sobra disponível',
  insufficient: 'Sobra das origens permitidas insuficiente',
  tie: 'Resultado antigo: recalcule para aplicar o rateio',
  unallocated: 'Necessidade não coberta pela distribuição',
};
const PAGE_SIZE = 75;
const needHeaders = ['Produto', 'EAN', 'Destino', 'Necessidade', 'Sugerido', 'Faltam', 'Motivo'] as const;
const button = 'inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 hover:border-violet-400 disabled:opacity-40';

export function ReallocationUnmetNeeds({ report, calculatedAt, stale }: {
  report: ReallocationNeedsReport | null;
  calculatedAt?: string;
  stale: boolean;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const sort = useColumnSort();
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const query = normalize(search.trim());
  const rows = sort.sortRowsBy((report?.rows ?? []).filter(row => !query
    || normalize(`${row.product} ${row.ean} ${row.destinationCode} ${row.destinationName} ${reasonLabels[row.reason]}`).includes(query)), row => ({
    Produto: row.product, EAN: row.ean, Destino: `${row.destinationCode} ${row.destinationName}`,
    Necessidade: row.needed, Sugerido: row.suggested, Faltam: row.needed - row.suggested, Motivo: reasonLabels[row.reason],
  }));
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visiblePage = Math.min(page, pageCount - 1);
  return <>
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
      <div>
        <h2 className="text-sm font-bold text-slate-900">Necessidades sem atendimento</h2>
        {report && <p className="mt-0.5 text-xs text-slate-600">
          Último cálculo{calculatedAt ? ` · ${new Date(calculatedAt).toLocaleString('pt-BR')}` : ''} · {format(report.total)} {report.total === 1 ? 'item por loja' : 'itens por loja'} · {format(report.missingUnits)} un. em falta
        </p>}
      </div>
      {Boolean(report?.rows.length) && <label className="relative w-full max-w-xs">
        <Search aria-hidden="true" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input type="search" aria-label="Pesquisar necessidades" placeholder="Pesquisar necessidades..." value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(0); }}
          className="h-8 w-full rounded border border-slate-200 bg-white pl-8 pr-2 text-xs text-slate-800" />
      </label>}
    </header>
    {stale && report && <p className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900">Filtros ou perfil alterados. Recalcule para atualizar a lista.</p>}
    {report && report.total > report.rows.length && <p className="border-b border-slate-200 px-3 py-1.5 text-xs text-slate-600">
      Mostrando as {format(report.rows.length)} maiores faltas de {format(report.total)}. Refine os filtros e recalcule para consultar outras.
    </p>}
    {rows.length > 0 ? <div className="min-h-0 flex-1 overflow-auto">
      <table className="block w-full border-separate border-spacing-0 text-left text-xs text-slate-800 sm:table sm:min-w-[760px]">
        <thead className="sticky top-0 z-10 hidden bg-slate-100 text-slate-700 sm:table-header-group"><tr>
          {needHeaders.map((column, index) => <SortableTableHeader key={column} sort={sort} column={column}
            className={`border-b border-slate-200 px-3 py-2 ${index >= 3 && index <= 5 ? 'text-right' : ''}`} />)}
        </tr></thead>
        <tbody className="block sm:table-row-group">{rows.slice(visiblePage * PAGE_SIZE, (visiblePage + 1) * PAGE_SIZE).map(row => <tr key={`${row.ean}:${row.destinationCode}`}
          className="grid grid-cols-3 border-b border-slate-200 py-1 odd:bg-white even:bg-slate-50 sm:table-row sm:border-0 sm:py-0">
          <th scope="row" className="col-span-2 min-w-0 break-words px-3 py-1 font-semibold sm:border-b sm:border-slate-100 sm:py-2">
            {row.product || row.ean}{row.product && <span className="block font-normal text-slate-500 sm:hidden">{row.ean}</span>}
          </th>
          <td className="hidden border-b border-slate-100 px-3 py-2 sm:table-cell">{row.ean}</td>
          <td className="min-w-0 break-words px-3 py-1 sm:border-b sm:border-slate-100 sm:py-2">{row.destinationCode} · {row.destinationName}</td>
          <td className="px-3 py-1 tabular-nums sm:border-b sm:border-slate-100 sm:py-2 sm:text-right"><span className="block text-slate-500 sm:hidden">Necessidade</span>{format(row.needed)}</td>
          <td className="px-3 py-1 tabular-nums sm:border-b sm:border-slate-100 sm:py-2 sm:text-right"><span className="block text-slate-500 sm:hidden">Sugerido</span>{format(row.suggested)}</td>
          <td className="px-3 py-1 font-bold text-amber-800 tabular-nums sm:border-b sm:border-slate-100 sm:py-2 sm:text-right"><span className="block font-normal sm:hidden">Faltam</span>{format(row.needed - row.suggested)}</td>
          <td className="col-span-3 px-3 py-1 text-slate-600 sm:border-b sm:border-slate-100 sm:py-2">{reasonLabels[row.reason]}</td>
        </tr>)}</tbody>
      </table>
    </div> : <p className="grid min-h-28 flex-1 place-items-center px-3 text-center text-xs font-semibold text-slate-600">
      {!report ? 'Gere sugestões para ver as necessidades não atendidas.' : query ? 'Nenhuma necessidade encontrada na pesquisa.' : 'Nenhuma necessidade ficou sem atendimento neste cálculo.'}
    </p>}
    {pageCount > 1 && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-3 py-1.5 text-xs text-slate-600">
      <button type="button" className={button} aria-label="Página anterior" title="Página anterior" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}><ChevronLeft size={14} /></button>
      <span>{visiblePage + 1} de {pageCount}</span>
      <button type="button" className={button} aria-label="Próxima página" title="Próxima página" disabled={visiblePage + 1 >= pageCount} onClick={() => setPage(visiblePage + 1)}><ChevronRight size={14} /></button>
    </div>}
  </>;
}

type InspectionRow = Parameters<typeof getReallocationDestinationCoverage>[0] & {
  description: string;
  originName: string; originStock: number; originConfirmedStock: number; originStockDays: number; originMonthlyAvgSales: number;
  originProtectedStock?: number; originSurplusBeforeAllocation?: number; originCurve: string;
  originLastSaleDays?: number | null; originLastPurchaseDays?: number | null;
  destinationName: string; destinationStock: number; destinationConfirmedStock: number; destinationStockDays: number;
  destinationMonthlyAvgSales: number; destinationCurve: string; routePriority: number;
  destinationLastSaleDays?: number | null; destinationLastPurchaseDays?: number | null;
  automaticSplitDestinations?: number;
  automaticSplitGroups?: string[];
};

function formatMovementDays(value?: number | null) {
  if (value == null) return 'Sem dado';
  if (value === 0) return '0 dias';
  return `Há ${days.format(value)} ${value === 1 ? 'dia' : 'dias'}`;
}

function MovementDetails({ sale, purchase }: { sale?: number | null; purchase?: number | null }) {
  return <p className="mt-1 font-semibold text-slate-900">
    Última venda: {formatMovementDays(sale)} · Última compra: {formatMovementDays(purchase)}
  </p>;
}

export function ReallocationRowInspection({ row, routes }: {
  row: InspectionRow | undefined;
  routes: InspectionRow[];
}) {
  const coverage = row && getReallocationDestinationCoverage(row, routes);
  const excess = coverage ? Math.max(0, coverage.suggested - coverage.needed) : 0;
  const splitDestinations = row && hasAutomaticSplit(row) ? getReallocationSplitDestinations(row, routes) : [];
  const desktopColumns = splitDestinations.length > 0
    ? 'xl:grid-cols-[minmax(0,0.8fr)_repeat(2,minmax(0,1fr))_minmax(0,1.35fr)]'
    : 'xl:grid-cols-[minmax(0,0.8fr)_repeat(2,minmax(0,1fr))]';
  return <aside id="reallocation-row-inspection" aria-label="Raio-X da sugestão"
    className={`grid h-[min(40dvh,12rem)] shrink-0 content-start items-start gap-2 overflow-auto border-t border-violet-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 xl:h-[min(40dvh,8rem)] ${row ? `md:grid-cols-2 xl:auto-rows-fr xl:[&>*]:overflow-y-auto ${desktopColumns}` : ''}`}>
    <header className="min-w-0 self-stretch break-words">
      <h2 className="font-bold text-violet-800">Raio-X{row && ` · ${row.description || row.ean}`}</h2>
      {row && <p className="mt-0.5 text-slate-600">
        Prioridade de rota {row.routePriority} · Curvas {row.originCurve || '–'} → {row.destinationCurve || '–'} · {format(row.quantity)} un. nesta rota
      </p>}
      {row && Number(row.automaticSplitDestinations) > 1 && <p className="mt-1 font-semibold text-orange-900">
        Rateio automático · {format(row.automaticSplitDestinations)} destinos empatados disputavam a sobra
      </p>}
    </header>
    {row && coverage ? <>
      <section className="min-w-0 self-stretch break-words rounded-md border border-slate-200 bg-white px-3 py-2 text-sm/[18px]">
        <h3 className="mb-1 font-bold">Origem · {row.originCode} {row.originName}</h3>
        <p>Físico: {format(row.originStock)} · Confirmado: {format(row.originConfirmedStock)} · Venda/mês: {format(row.originMonthlyAvgSales)} · Cobertura: {row.originMonthlyAvgSales > 0 ? `${days.format(row.originStockDays)} dias` : 'sem giro'}</p>
        <MovementDetails sale={row.originLastSaleDays} purchase={row.originLastPurchaseDays} />
        <p className="mt-1 text-slate-600">Reserva do perfil: {format(row.originProtectedStock)} un. · Sobra inicial para transferir: {format(row.originSurplusBeforeAllocation)} un.</p>
      </section>
      <section className="min-w-0 self-stretch break-words rounded-md border border-slate-200 bg-white px-3 py-2 text-sm/[18px]">
        <h3 className="mb-1 font-bold">Destino · {row.destinationCode} {row.destinationName}</h3>
        <p>Físico: {format(row.destinationStock)} · Confirmado: {format(row.destinationConfirmedStock)} · Venda/mês: {format(row.destinationMonthlyAvgSales)} · Cobertura: {row.destinationMonthlyAvgSales > 0 ? `${days.format(row.destinationStockDays)} dias` : 'sem giro'}</p>
        <MovementDetails sale={row.destinationLastSaleDays} purchase={row.destinationLastPurchaseDays} />
        <p className="mt-1 font-semibold">Necessidade: {format(coverage.needed)} un. · Planejado: {format(coverage.suggested)} un. de {format(coverage.originCount)} {coverage.originCount === 1 ? 'origem' : 'origens'}
          {coverage.needed > 0 && ` (${percentage.format(coverage.suggested / coverage.needed)})`} · {excess > 0
            ? <span className="text-red-700">Excede: {format(excess)} un.</span>
            : <span className={coverage.missing > 0 ? 'text-amber-800' : 'text-emerald-800'}>Faltam: {format(coverage.missing)} un.</span>}
        </p>
      </section>
    </> : <p className="text-slate-600">Selecione uma linha da tabela.</p>}
    {splitDestinations.length > 0 && <section aria-label="Destinos do rateio" className="min-w-0 self-stretch break-words rounded-md border border-orange-200 bg-white px-3 py-2">
      <h3 className="font-bold text-orange-900">Destinos do rateio</h3>
      <ul className="mt-1 divide-y divide-slate-200">
        {splitDestinations.map(destination => <li key={destination.code} className="flex flex-wrap items-start gap-x-3 gap-y-0.5 py-1">
          <span className="font-semibold">{destination.code} {destination.name}</span>
          <span className={destination.planned >= destination.needed ? 'font-semibold text-emerald-800' : 'font-semibold text-amber-800'}>
            {format(destination.planned)} de {format(destination.needed)} un. · {destination.planned >= destination.needed ? 'Suprido' : `Faltam ${format(destination.needed - destination.planned)} un.`}
          </span>
          <span className="min-w-0 break-words text-slate-600">{destination.routes.map(route =>
            `${route.originCode} ${route.originName}: ${format(route.quantity)} un.`
          ).join(' · ')}</span>
        </li>)}
      </ul>
    </section>}
  </aside>;
}
