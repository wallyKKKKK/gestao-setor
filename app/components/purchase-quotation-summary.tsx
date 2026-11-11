'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, BarChart3, ClipboardList, RefreshCw, Wallet } from 'lucide-react';
import { getAuthHeaders } from '@/lib/auth-headers';
import { quotationTimeZone, type PurchaseQuotationSummary } from '@/lib/purchase-quotation-summary';

const number = new Intl.NumberFormat('pt-BR');
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 2 });
const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: quotationTimeZone });
const headingClass = 'flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900';
const metricLabel = 'text-sm font-medium text-slate-600';

export function QuotationSummary({ onSuppliers }: { onSuppliers: () => void }) {
  const [summary, setSummary] = useState<PurchaseQuotationSummary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      const response = await fetch('/api/purchase-quotation/summary', {
        headers: await getAuthHeaders(), cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) throw new Error('Não foi possível carregar o resumo das cotações.');
      return await response.json() as PurchaseQuotationSummary;
    };
    void load().then(data => {
      if (!controller.signal.aborted) setSummary(data);
    }).catch(() => {
      if (!controller.signal.aborted) setError('Não foi possível atualizar o resumo das cotações.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [reload]);

  const current = summary?.months[0];
  return (
    <section aria-labelledby="quotation-summary-title" className="mx-auto w-full max-w-7xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="quotation-summary-title" className="text-lg font-bold text-slate-900">Resumo das cotações</h2>
        <button type="button" className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:border-emerald-600 disabled:opacity-60"
          disabled={loading} onClick={() => { setLoading(true); setError(''); setReload(value => value + 1); }}>
          <RefreshCw size={14} aria-hidden="true" /> {loading ? 'Atualizando...' : 'Atualizar resumo'}
        </button>
      </header>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!summary && loading && <p role="status" className="text-sm text-slate-600">Carregando indicadores...</p>}
      {summary && current && <>
        <div className="grid gap-5 md:grid-cols-2 lg:gap-6">
          <section className="min-w-0 border-t border-slate-200 pt-3">
            <h3 className={headingClass}><ClipboardList size={17} className="text-emerald-700" aria-hidden="true" /> Andamento</h3>
            <dl className="mt-2 divide-y divide-slate-200 text-sm">
              {([
                ['Em andamento', summary.ongoing, null],
                ['Finalizadas', summary.closed, null],
                ['Convites aguardando resposta', summary.pendingInvites, null],
                ['Fornecedores cadastrados', summary.suppliers, onSuppliers],
              ] as const).map(([label, value, action]) => (
                <div key={label} className="grid grid-cols-[1fr_auto] items-center gap-3 py-3.5">
                  <dt className="min-w-0 text-slate-700">{label}</dt>
                  <dd>{action ? <button type="button" onClick={action} aria-label={`${label}: ${number.format(value)}`}
                    className="inline-flex min-w-16 items-center justify-end gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-base font-semibold text-emerald-800 tabular-nums hover:border-emerald-600">
                    {number.format(value)} <ArrowUpRight size={13} aria-hidden="true" />
                  </button> : <span className="px-2.5 text-base font-semibold text-slate-900 tabular-nums">{number.format(value)}</span>}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="min-w-0 border-t border-slate-200 pt-3">
            <h3 className={headingClass}><Wallet size={17} className="text-emerald-700" aria-hidden="true" /> Economia nos pedidos aprovados</h3>
            <p className="mt-1 text-xs text-slate-600">Comparação com o último custo de entrada.</p>
            <dl className="mt-2 divide-y divide-slate-200 text-sm">
              {summary.months.map(month => {
                const difference = month.referenceTotalCents - month.comparablePaidCents;
                return <div key={month.start} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3 py-3.5">
                  <dt className="min-w-0 text-slate-700 capitalize">{monthLabel.format(new Date(month.start))}</dt>
                  <dd className="text-right">
                    {month.comparableLines ? <>
                      <p className={`break-words text-base font-semibold tabular-nums ${difference < 0 ? 'text-amber-800' : 'text-emerald-800'}`}>
                        {money.format(Math.abs(difference) / 100)}{month.referenceTotalCents > 0 ? ` · ${percent.format(Math.abs(difference) / month.referenceTotalCents)}` : ''}
                      </p>
                      <p className="text-xs text-slate-600">{difference < 0 ? 'Acima do custo' : difference === 0 ? 'Igual ao custo' : 'Economia'} · {number.format(month.comparableLines)} de {number.format(month.lines)} linhas comparadas</p>
                    </> : <span className="text-xs text-slate-600">{month.orders ? 'Sem custo comparável' : 'Sem pedidos aprovados'}</span>}
                  </dd>
                </div>;
              })}
            </dl>
          </section>
        </div>
        <section className="border-t border-slate-200 pt-3">
          <h3 className={headingClass}><BarChart3 size={17} className="text-emerald-700" aria-hidden="true" /> Movimento do mês <span className="text-xs font-normal text-slate-600">{monthLabel.format(new Date(current.start))}</span></h3>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              ['Cotações abertas para fornecedores', number.format(summary.createdThisMonth)],
              ['Respostas recebidas', number.format(summary.responsesThisMonth)],
              ['Pedidos gerados', number.format(current.orders)],
              ['Fornecedores com pedido', number.format(current.suppliersWithOrders)],
              ['Valor dos pedidos aprovados', money.format(current.orderTotalCents / 100)],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 rounded-md border border-slate-200 bg-white p-3 sm:p-4">
                <dt className={metricLabel}>{label}</dt>
                <dd className="mt-2 break-words text-xl font-bold text-slate-900 tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </>}
    </section>
  );
}
