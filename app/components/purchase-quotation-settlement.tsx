'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, LockKeyhole, RefreshCw, Save } from 'lucide-react';
import { getAuthHeaders } from '@/lib/auth-headers';
import { SortableTableHeader, useColumnSort } from '@/app/components/table-sort';
import { assessQuotation, emptySettlement, type ItemDecision, type SettlementDecisions, type SettlementInvite, type SettlementRound, type SettlementRecord, type QuotationOrder } from '@/lib/purchase-quotation-settlement';

type Detail = { round: SettlementRound; invites: SettlementInvite[]; settlement: SettlementRecord | null };
const endpoint = '/api/purchase-quotation/settlement';
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 });
const control = 'min-w-0 rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900';
const button = 'inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:border-emerald-600 disabled:opacity-50';
const section = 'rounded-lg border border-slate-200 bg-white p-3';
const cell = 'border-b border-slate-200 px-3 py-2 align-top';
const pageSize = 40;

async function request<T>(suffix = '', options: RequestInit = {}): Promise<T> {
  const response = await fetch(endpoint + suffix, {
    ...options, cache: 'no-store',
    headers: { ...await getAuthHeaders(), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível consultar a apuração.');
  return data;
}

async function downloadOrder(order: QuotationOrder, index: number) {
  const xlsx = await import('xlsx');
  const book = xlsx.utils.book_new();
  const sheet = xlsx.utils.json_to_sheet(order.lines.map(line => ({
    Fornecedor: order.supplierName, Loja: line.branchCnpj, Código: line.code, EAN: line.ean,
    Produto: line.description, Quantidade: line.quantity, 'Preço cotado': line.unitPrice, Total: line.totalCents / 100,
  })));
  xlsx.utils.book_append_sheet(book, sheet, 'Pedido');
  xlsx.writeFile(book, `pedido-${index + 1}.xlsx`);
}

export function PurchaseQuotationSettlement({ active, roundId, onClosed, onDirtyChange }: {
  active: boolean; roundId: string; onClosed: (roundId: string, closedAt: string) => void; onDirtyChange: (dirty: boolean) => void;
}) {
  const rowSort = useColumnSort();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [decisions, setDecisions] = useState<SettlementDecisions>(emptySettlement);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState('');
  const [reload, setReload] = useState(0);
  const [checkedAt, setCheckedAt] = useState(0);
  const dirtyRef = useRef(false);
  const updateClock = useCallback(() => setCheckedAt(Date.now()), []);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void request<Detail>(`?roundId=${roundId}`, { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      if (dirtyRef.current && !data.settlement?.closed_at) {
        // Keep the original saved revision so a concurrent edit still triggers a conflict.
        setDetail(current => ({ ...data, settlement: current?.settlement ?? null }));
      } else {
        setDetail(data);
        setDecisions(data.settlement?.decisions ?? emptySettlement);
        dirtyRef.current = false;
        setDirty(false);
      }
      updateClock();
      if (data.settlement?.closed_at) onClosed(roundId, data.settlement.closed_at);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [active, roundId, reload, updateClock, onClosed]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(updateClock, 15000);
    return () => window.clearInterval(interval);
  }, [active, updateClock]);

  const assessment = useMemo(() => detail ? assessQuotation(detail.round, detail.invites, decisions) : null, [detail, decisions]);
  const respondents = useMemo(() => detail?.invites.filter(invite => invite.submitted_at && !invite.revoked_at).map(invite => ({
    ...invite, unavailable: new Set(invite.proposal?.unavailableItemIds ?? []),
  })) ?? [], [detail]);
  const pending = detail?.invites.filter(invite => !invite.revoked_at && !invite.submitted_at && Date.parse(invite.expires_at) > checkedAt).length ?? 0;
  const filtered = assessment?.rows.filter(row => {
    const matches = `${row.item.description} ${row.item.ean} ${row.item.code}`.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR'));
    return matches && (filter === 'all' || (filter === 'cost' ? row.tag === 'Não comprar' : row.reasons.length > 0));
  }) ?? [];
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
  const sorted = rowSort.sortRows(filtered, (row, column) => {
    if (column === 'product') return row.item.description;
    if (column === 'reference') return row.reference;
    if (column === 'winner') return row.winner?.supplier.supplier_name;
    return row.options.find(option => option.supplier.supplier_id === column)?.unitPrice;
  });
  const closed = detail?.settlement?.closed_at;
  const setItem = (itemId: string, patch: Partial<ItemDecision>, structural = false) => {
    dirtyRef.current = true;
    setDirty(true);
    setDecisions(current => ({
      minimumApprovals: structural ? {} : current.minimumApprovals,
      items: { ...current.items, [itemId]: { ...current.items[itemId], ...(structural ? { approval: '', approvalBasis: '' } : {}), ...patch } },
    }));
  };
  const refresh = () => {
    if (dirty && !window.confirm('Descartar as alterações ainda não salvas?')) return;
    dirtyRef.current = false;
    setDirty(false);
    setLoading(true); setError(''); setDetail(null); setExpanded(''); setPage(0);
    setReload(value => value + 1);
  };
  const save = async (action: 'save' | 'close') => {
    if (!detail || saving) return;
    const omitted = assessment?.rows.filter(row => !row.winner).length ?? 0;
    if (action === 'close' && !window.confirm(`Fechar esta cotação e gerar os pedidos? ${omitted} produto(s) ficarão fora dos pedidos. Depois do fechamento não será possível editar.`)) return;
    setSaving(true);
    setError('');
    try {
      const { settlement } = await request<{ settlement: SettlementRecord }>('', {
        method: 'POST', body: JSON.stringify({
          roundId, revision: detail.settlement?.revision ?? null, action, decisions,
          submittedSuppliers: respondents.map(invite => invite.supplier_id),
        }),
      });
      setDetail({ ...detail, settlement });
      setDecisions(settlement.decisions);
      dirtyRef.current = false;
      setDirty(false);
      if (settlement.closed_at) onClosed(roundId, settlement.closed_at);
    } catch (cause) { setError((cause as Error).message); }
    finally { setSaving(false); }
  };

  return <div hidden={!active} className="space-y-3 text-sm text-slate-900">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-bold">{closed ? 'Pedidos por fornecedor' : 'Apuração da cotação'}</h2>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button type="button" aria-label="Atualizar apuração" title="Atualizar apuração" className={button} disabled={saving || loading} onClick={refresh}><RefreshCw size={15} /></button>
      </div>
    </header>
    {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-red-800">{error}</p>}
    {loading ? <p role="status">Carregando apuração...</p> : !detail || !assessment ? !error && <p>Nenhuma cotação com convite disponível para apurar.</p> : closed ? <>
      <p className="font-semibold text-emerald-800">Cotação fechada em {new Date(closed).toLocaleString('pt-BR')}</p>
      {detail.settlement?.orders?.map((order, index) => <details key={order.supplierId} className={section}>
        <summary className="cursor-pointer font-semibold">{order.supplierName} · {order.lines.length} linhas · {money.format(order.totalCents / 100)}</summary>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
          <span>Pagamento: {order.paymentDays ?? '—'} dias · Entrega: {order.deliveryDays ?? '—'} dias</span>
          <button className={button} type="button" onClick={() => void downloadOrder(order, index).catch(() => setError('Não foi possível baixar o pedido.'))}><Download size={15} /> Baixar pedido em Excel</button>
        </div>
        <OrderLinesTable lines={order.lines} />
      </details>)}
    </> : <fieldset disabled={saving} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${control} w-64 max-w-full`} type="search" aria-label="Pesquisar produto" placeholder="Buscar produto, código ou EAN" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />
        <select className={control} aria-label="Filtrar produtos" value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}>
          <option value="all">Todos os produtos</option><option value="cost">Acima do custo</option><option value="issues">Com pendência</option>
        </select>
        <span className="text-xs text-slate-600">{respondents.length} respostas · {pending} convites pendentes · {assessment.rows.filter(row => !row.winner).length} produtos sem compra</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50"><tr>
            <SortableTableHeader sort={rowSort} column="product" className={`${cell} min-w-44`}>Produto</SortableTableHeader>
            <SortableTableHeader sort={rowSort} column="reference" className={`${cell} min-w-32`}>Custo e decisão</SortableTableHeader>
            {respondents.map(invite => <SortableTableHeader sort={rowSort} column={invite.supplier_id} key={invite.supplier_id} className={`${cell} min-w-28`}>{invite.supplier_name}</SortableTableHeader>)}
            <SortableTableHeader sort={rowSort} column="winner" className={`${cell} min-w-36`}>Vencedor</SortableTableHeader>
          </tr></thead>
          <tbody>
            {sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(row => {
              const decision = decisions.items[row.item.id] ?? {};
              const isExpanded = expanded === row.item.id;
              const original = row.branches.reduce((total, branch) => total + branch.quantity, 0);
              const needsApproval = row.tag === 'Não comprar' || row.tag === 'Sem referência';
              const selectedSupplier = decision.supplierId === undefined ? 'auto' : decision.supplierId ?? 'none';
              return <SettlementItemRows key={row.item.id} {...{ row, decision, isExpanded, original, needsApproval, selectedSupplier, respondents, setItem }}
                onToggle={() => setExpanded(isExpanded ? '' : row.item.id)} />;
            })}
            {!filtered.length && <tr><td colSpan={respondents.length + 3} className="p-6 text-center text-slate-600">Nenhum produto encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
      {filtered.length > pageSize && <div className="flex items-center gap-2 text-xs">
        <button type="button" className={button} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Anterior</button>
        <span>Página {currentPage + 1} de {Math.ceil(filtered.length / pageSize)}</span>
        <button type="button" className={button} disabled={(currentPage + 1) * pageSize >= filtered.length} onClick={() => setPage(currentPage + 1)}>Próxima</button>
      </div>}
      {assessment.minimums.map(minimum => <section key={minimum.supplierId} className={`${section} space-y-2`}>
        <h2 className="font-semibold text-amber-900">{minimum.supplierName}: faltam {money.format(minimum.shortfallCents / 100)} para o mínimo</h2>
        <p className="text-xs">Total: {money.format(minimum.totalCents / 100)} · Mínimo: {money.format(minimum.minimumCents / 100)}</p>
        {minimum.alternatives.map(alternative => <p key={alternative.itemId} className="text-xs">
          {alternative.description}: {alternative.from} → {alternative.to} · impacto {alternative.deltaCents > 0 ? '+' : ''}{money.format(alternative.deltaCents / 100)}
        </p>)}
        <label className="block text-xs font-medium">Motivo para liberar abaixo do mínimo
          <input className={`${control} mt-1 block w-full max-w-lg`} maxLength={500}
            value={decisions.minimumApprovals[minimum.supplierId]?.totalCents === minimum.totalCents ? decisions.minimumApprovals[minimum.supplierId].reason : ''}
            onChange={event => {
              const reason = event.currentTarget.value;
              dirtyRef.current = true;
              setDirty(true);
              setDecisions(current => ({ ...current, minimumApprovals: { ...current.minimumApprovals, [minimum.supplierId]: { reason, totalCents: minimum.totalCents } } }));
            }} />
        </label>
      </section>)}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
        <p className="text-xs text-slate-700">{assessment.orders.length} pedidos previstos · {assessment.blockers.length} pendências{pending > 0 ? ' · Aguarde ou revogue os convites pendentes para fechar.' : ''}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={!dirty} onClick={() => void save('save')}><Save size={15} /> Salvar apuração</button>
          <button type="button" className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            disabled={!assessment.orders.length || assessment.blockers.length > 0 || pending > 0} onClick={() => void save('close')}><LockKeyhole size={15} /> Fechar e gerar pedidos</button>
        </div>
      </footer>
    </fieldset>}
  </div>;
}

function OrderLinesTable({ lines }: { lines: QuotationOrder['lines'] }) {
  const sort = useColumnSort();
  const columns = [
    ['description', 'Produto'], ['branchCnpj', 'Loja (CNPJ)'], ['originalQuantity', 'Original'],
    ['quantity', 'Aprovada'], ['unitPrice', 'Preço'], ['totalCents', 'Total'],
  ] as const;
  const sorted = sort.sortRows(lines, (line, key) => line[key as typeof columns[number][0]]);
  return <div className="overflow-x-auto"><table className="mt-2 w-full text-left text-xs">
    <thead><tr>{columns.map(([key, label]) => <SortableTableHeader key={key} sort={sort} column={key} className={cell}>{label}</SortableTableHeader>)}</tr></thead>
    <tbody>{sorted.map(line => <tr key={`${line.itemId}:${line.branchCnpj}`}>
      <td className={cell}>{line.description}</td><td className={cell}>{line.branchCnpj}</td><td className={cell}>{line.originalQuantity}</td><td className={cell}>{line.quantity}</td><td className={cell}>{money.format(line.unitPrice)}</td><td className={cell}>{money.format(line.totalCents / 100)}</td>
    </tr>)}</tbody>
  </table></div>;
}

type AssessedRow = ReturnType<typeof assessQuotation>['rows'][number];
function SettlementItemRows({ row, decision, isExpanded, original, needsApproval, selectedSupplier, respondents, setItem, onToggle }: {
  row: AssessedRow; decision: ItemDecision; isExpanded: boolean; original: number; needsApproval: boolean; selectedSupplier: string;
  respondents: Array<SettlementInvite & { unavailable: Set<string> }>;
  setItem: (id: string, patch: Partial<ItemDecision>, structural?: boolean) => void; onToggle: () => void;
}) {
  const offers = new Map(row.options.map(option => [option.supplier.supplier_id, option]));
  const percent = row.reference && decision.unitsPerPackage && row.difference !== null ? row.difference / (row.reference * decision.unitsPerPackage) * 100 : null;
  return <>
    <tr>
      <th scope="row" className={cell}><button type="button" className="text-left font-semibold text-emerald-800 hover:underline" aria-expanded={isExpanded} onClick={onToggle}>{row.item.description}</button>
        <span className="mt-1 block font-normal text-slate-600">{row.item.ean} · Qtd. {original}{original !== row.quantity ? ` → ${row.quantity}` : ''}</span></th>
      <td className={cell}>{row.reference !== null ? money.format(row.reference) + ' / un.' : 'Sem custo'}
        <strong className={`mt-1 block ${row.tag === 'Comprar' ? 'text-emerald-800' : needsApproval ? 'text-red-700' : 'text-slate-700'}`}>{row.tag}</strong>
        {row.difference !== null && row.difference > 0 && <span className="text-red-700">+{money.format(row.difference)} ({percent?.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%)</span>}
        {!!row.reasons.length && <span className="block text-amber-800">{row.reasons.length} pendência(s)</span>}
      </td>
      {respondents.map(invite => {
        const offer = offers.get(invite.supplier_id);
        return <td key={invite.supplier_id} className={`${cell} ${row.winner?.supplier.supplier_id === invite.supplier_id ? 'bg-emerald-50' : ''}`}>
          {offer ? <><strong>{money.format(offer.unitPrice)}</strong><span className="mt-1 block text-slate-600">{offer.available} disp. · múltiplo {offer.multiple}</span>
            {!offer.eligible && <span className="block text-amber-800">Não atende</span>}</> : invite.unavailable.has(row.item.id) ? 'Indisponível' : 'Sem preço'}
        </td>;
      })}
      <td className={cell}><select aria-label={`Vencedor: ${row.item.description}`} className={`${control} w-full max-w-48`} value={selectedSupplier}
        onChange={event => {
          const value = event.target.value;
          setItem(row.item.id, { supplierId: value === 'auto' ? undefined : value === 'none' ? null : value }, true);
          if (!isExpanded) onToggle();
        }}>
        <option value="auto">Automático</option><option value="none">Não comprar</option>
        {row.options.filter(option => option.eligible || option.supplier.supplier_id === selectedSupplier).map(option =>
          <option key={option.supplier.supplier_id} value={option.supplier.supplier_id}>{option.supplier.supplier_name}</option>)}
      </select><span className="mt-1 block text-slate-600">{row.winner?.supplier.supplier_name ?? 'Sem vencedor'}</span></td>
    </tr>
    {isExpanded && <tr><td colSpan={respondents.length + 3} className={`${cell} bg-slate-50`}>
      <div className="flex max-w-[min(60rem,80vw)] flex-wrap items-start gap-4 py-2">
        <div className="grid gap-1">
          <strong>Quantidade por loja</strong>
          {row.branches.map(branch => <label key={branch.branchCnpj} className="flex flex-wrap items-center gap-2">
            <span>{branch.branchCnpj} · original: {branch.quantity}</span>
            <input className={`${control} w-20`} type="number" min={0} max={9999999} step={1} value={branch.finalQuantity}
              onChange={event => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isSafeInteger(value) && value >= 0 && value <= 9999999) setItem(row.item.id, { quantities: { ...decision.quantities, [branch.branchCnpj]: value } }, true);
              }} />
          </label>)}
        </div>
        <div className="grid flex-1 gap-2">
          <label className="grid gap-1">Unidades por embalagem
            <input className={`${control} w-24`} type="number" min={1} max={999999} step={1} value={decision.unitsPerPackage ?? ''}
              onChange={event => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isNaN(value) || (Number.isSafeInteger(value) && value > 0 && value <= 999999)) setItem(row.item.id, { unitsPerPackage: Number.isNaN(value) ? undefined : value }, true);
              }} />
          </label>
          <label className="grid gap-1">Motivo da alteração de fornecedor ou quantidade
            <input className={control} maxLength={500} value={decision.reason ?? ''} onChange={event => setItem(row.item.id, { reason: event.target.value })} />
          </label>
          {needsApproval && <label className="grid gap-1">Motivo para autorizar esta compra
            <input className={control} maxLength={500} value={decision.approvalBasis === row.approvalBasis ? decision.approval ?? '' : ''}
              onChange={event => setItem(row.item.id, { approval: event.target.value, approvalBasis: row.approvalBasis })} />
          </label>}
          {row.reasons.map(reason => <p key={reason} className="text-amber-900">{reason}</p>)}
        </div>
      </div>
    </td></tr>}
  </>;
}
