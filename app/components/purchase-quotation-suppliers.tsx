'use client';

import { SortableTableHeader, useColumnSort } from '@/app/components/table-sort';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Copy, Link2, Mail, Pencil, Plus } from 'lucide-react';
import { BrazilianDateField, TimePickerField } from '@/app/components/date-time-fields';
import { getAuthHeaders } from '@/lib/auth-headers';
import type { QuotationInvite, QuotationSupplier, SupplierItem, SupplierProposal } from '@/lib/purchase-quotation-supplier';
import type { QuotationRoundIdentity } from '@/lib/purchase-quotation-workflow';

const input = 'mt-1 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 py-2 text-sm';
const button = 'inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50';
const primary = 'inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50';
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 });
const formatDate = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Fortaleza' });
const fields = [
  ['name', 'Razão social', 200, 'text', true], ['cnpj', 'CNPJ', 24, 'text', true],
  ['contact', 'Nome do representante', 120, 'text', false], ['email', 'E-mail', 254, 'email', false],
  ['whatsapp', 'WhatsApp', 40, 'tel', false], ['coverage', 'Marcas e categorias atendidas', 500, 'text', false],
] as const;

async function buyerRequest<T>(body?: Record<string, unknown>, scope = ''): Promise<T> {
  const response = await fetch('/api/purchase-quotation' + scope, {
    method: body ? 'POST' : 'GET', headers: { ...await getAuthHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? 'Não foi possível acessar a cotação.');
  return data as T;
}

type ReceivedProposal = { supplier_name: string; proposal: SupplierProposal; submitted_at: string; round: { supplier_items: SupplierItem[] } };
type GeneratedLink = { supplierId: string; label: string; email: string; url: string };
const representativeName = (supplier: QuotationSupplier) => supplier.contact.trim() || supplier.name;

export function PurchaseQuotationSuppliers({ revision, mode, roundId, closed, onTrack, onPublished, onGenerating }: {
  revision: number | null; mode: 'catalog' | 'tracking' | 'participants';
  roundId?: string; closed?: boolean; onTrack?: (round: QuotationRoundIdentity) => void;
  onPublished?: () => void;
  onGenerating?: (busy: boolean) => void;
}) {
  const [suppliers, setSuppliers] = useState<QuotationSupplier[]>([]);
  const [invites, setInvites] = useState<QuotationInvite[]>([]);
  const [editing, setEditing] = useState<QuotationSupplier | 'new' | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deadlineTime, setDeadlineTime] = useState('');
  const [links, setLinks] = useState<GeneratedLink[]>([]);
  const [createdRound, setCreatedRound] = useState<QuotationRoundIdentity | null>(null);
  const [adding, setAdding] = useState(false);
  const [detail, setDetail] = useState<ReceivedProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [checkedAt, setCheckedAt] = useState(0);
  const inFlight = useRef(false);
  const tracking = mode === 'tracking';
  const catalogOnly = mode === 'catalog';
  const showParticipants = (mode === 'participants' && revision !== null) || (tracking && adding && !closed);
  const scope = catalogOnly || !roundId ? '' : `?roundId=${roundId}`;
  const CatalogContainer = catalogOnly ? 'section' : 'details';
  const rowSort = useColumnSort();
  const statusFor = (invite: QuotationInvite) => invite.submitted_at ? 'Respondida' : invite.revoked_at ? 'Revogado' : Date.parse(invite.expires_at) <= checkedAt ? 'Expirado' : invite.revision ? 'Rascunho' : 'Aguardando';
  const shownInvites = rowSort.sortRowsBy(invites, invite => ({
    Fornecedor: invite.supplier_name, Prazo: Date.parse(invite.expires_at), Status: statusFor(invite),
  }));
  const invited = new Map(shownInvites.map(invite => [invite.supplier_id, invite]));
  const selectedSuppliers = suppliers.filter(supplier => selected.includes(supplier.id) && !invited.has(supplier.id));
  const searchKey = search.trim().toLocaleLowerCase('pt-BR');
  const visibleSuppliers = suppliers.filter(supplier => `${supplier.contact} ${supplier.name}`.toLocaleLowerCase('pt-BR').includes(searchKey));
  const unavailableIds = new Set(detail?.proposal.unavailableItemIds ?? []);
  const unavailableItems = detail?.round.supplier_items.filter(item => unavailableIds.has(item.id)) ?? [];
  const unansweredCount = detail ? detail.round.supplier_items.length - detail.proposal.offers.length - unavailableItems.length : 0;

  const applyResults = useCallback((result: { suppliers: QuotationSupplier[]; invites: QuotationInvite[] }) => {
    setSuppliers(result.suppliers);
    setInvites(result.invites);
    setCheckedAt(Date.now());
  }, []);
  const refresh = (query = scope) => buyerRequest<{ suppliers: QuotationSupplier[]; invites: QuotationInvite[] }>(undefined, query).then(applyResults);
  useEffect(() => {
    let active = true;
    void buyerRequest<{ suppliers: QuotationSupplier[]; invites: QuotationInvite[] }>(undefined, scope)
      .then(result => { if (active) applyResults(result); })
      .catch(cause => { if (active) setError(cause.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applyResults, scope]);

  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a operação.'); }
    finally { inFlight.current = false; setBusy(false); }
  };

  const saveSupplier = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      const result = await buyerRequest<{ supplier: QuotationSupplier }>({
        action: 'supplier', id: typeof editing === 'object' ? editing?.id : undefined,
        supplier: {
          ...Object.fromEntries(fields.map(([key]) => [key, String(form.get(key) ?? '')])),
          minimum_order: Number(form.get('minimum_order')), payment_days: Number(form.get('payment_days')),
        },
      });
      setEditing(null);
      if (editing === 'new' && showParticipants) setSelected(current => [...current, result.supplier.id]);
      setNotice('Fornecedor salvo.');
      await refresh();
    });
  };

  const generateLinks = (targets: QuotationSupplier[], replace = false) => {
    if (!roundId || !targets.length || inFlight.current || closed) return;
    const expiresAt = new Date(`${deadlineDate}T${deadlineTime}:00-03:00`);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) { setError('Informe uma data e hora futuras para o prazo.'); return; }
    if (replace && !window.confirm('Gerar outro link e invalidar o anterior?')) return;
    onGenerating?.(true);
    void run(async () => {
      const generated: GeneratedLink[] = [];
      const failures: string[] = [];
      let targetRound = roundId;
      for (const supplier of targets) {
        try {
          const { token, round } = await buyerRequest<{ token: string; round: QuotationRoundIdentity }>({
            action: 'invite', supplierId: supplier.id, roundId: targetRound,
            ...(mode === 'participants' ? { draftVersion: revision } : {}),
            expiresAt: expiresAt.toISOString(), replace,
          });
          targetRound = round.id;
          setCreatedRound(round);
          onPublished?.();
          generated.push({ supplierId: supplier.id, label: representativeName(supplier), email: supplier.email, url: `${window.location.origin}/cotacao-fornecedor#${token}` });
        } catch (cause) { failures.push(`${representativeName(supplier)}: ${(cause as Error).message}`); }
      }
      const generatedIds = new Set(generated.map(link => link.supplierId));
      setLinks(current => [...current.filter(link => !generatedIds.has(link.supplierId)), ...generated]);
      setSelected(current => current.filter(id => !generatedIds.has(id)));
      if (generated.length) setNotice(`${generated.length} ${generated.length === 1 ? 'link gerado' : 'links gerados'}.`);
      try { await refresh(targetRound ? `?roundId=${targetRound}` : scope); }
      catch { failures.push('Não foi possível atualizar a lista de convites.'); }
      if (failures.length) setError(failures.join(' '));
    }).finally(() => onGenerating?.(false));
  };

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="text-sm font-semibold text-emerald-700">{notice}</p>}
      {tracking && !closed && <button type="button" className={button} aria-expanded={adding} onClick={() => setAdding(value => !value)}>
        <Plus size={14} /> {adding ? 'Ocultar seleção' : 'Adicionar representantes'}
      </button>}
      {showParticipants && <>
        <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
          <h1 className="text-xl font-bold">Representantes da cotação</h1>
          <form onSubmit={event => { event.preventDefault(); generateLinks(selectedSuppliers); }} className="mt-3 grid gap-3">
            <fieldset className="min-w-0" disabled={busy || loading}>
              <legend className="text-xs font-semibold text-slate-700">Participantes · {selectedSuppliers.length} selecionados</legend>
              <input type="search" className={input} aria-label="Buscar representante ou fornecedor" placeholder="Buscar representante ou fornecedor" value={search}
                onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />
              <div className="mt-2 max-h-56 divide-y divide-slate-100 overflow-auto rounded-md border border-slate-200">
                {visibleSuppliers.map(supplier => <label key={supplier.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <input type="checkbox" checked={(invited.has(supplier.id) && !invited.get(supplier.id)?.revoked_at) || selected.includes(supplier.id)} disabled={invited.has(supplier.id)}
                    onChange={event => {
                      const checked = event.currentTarget.checked;
                      setSelected(current => checked ? [...current, supplier.id] : current.filter(id => id !== supplier.id));
                    }} />
                  <span className="min-w-0 break-words"><strong>{representativeName(supplier)}</strong>{supplier.contact.trim() && <span className="ml-2 text-slate-600">{supplier.name}</span>}</span>
                  {invited.has(supplier.id) && <span className="ml-auto shrink-0 text-slate-600">{invited.get(supplier.id)?.revoked_at ? 'Revogado' : 'Com convite'}</span>}
                </label>)}
                {!visibleSuppliers.length && <p className="px-3 py-2 text-xs text-slate-600">{loading ? 'Carregando representantes...' : 'Nenhum representante encontrado.'}</p>}
              </div>
            </fieldset>
            <fieldset className="min-w-0 max-w-md" disabled={busy}>
              <legend className="text-xs font-semibold text-slate-700">Prazo da resposta (horário de Fortaleza)</legend>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <p aria-hidden="true" className="text-xs text-slate-600">Data</p>
                  <BrazilianDateField label="Data limite da resposta" value={deadlineDate} onChange={setDeadlineDate} required />
                </div>
                <div className="space-y-1">
                  <p aria-hidden="true" className="text-xs text-slate-600">Hora</p>
                  <TimePickerField label="Hora limite da resposta" value={deadlineTime} onChange={setDeadlineTime} exactMinutes alignEnd />
                </div>
              </div>
            </fieldset>
            <button type="submit" disabled={busy || loading || !selectedSuppliers.length} className={`${primary} justify-self-start`}><Link2 size={15} /> {busy ? 'Aguarde...' : 'Gerar links individuais'}</button>
          </form>
        </section>
      </>}
      {!catalogOnly && !closed && links.length > 0 && <section aria-label="Links gerados" className="rounded-lg border border-slate-200 bg-white p-3">
          <ul className="divide-y divide-slate-100">
            {links.map(link => <li key={link.supplierId} className="flex flex-wrap items-center gap-2 py-2 text-xs">
              <strong>{link.label}</strong>
              <input aria-label={`Link de ${link.label}`} value={link.url} readOnly onFocus={event => event.currentTarget.select()} className={`${input} mt-0 max-w-xs`} />
              <button type="button" className={button} onClick={() => void navigator.clipboard?.writeText(link.url).then(() => setNotice('Link copiado.')).catch(() => setNotice('Selecione o link acima para copiar.'))}><Copy size={14} /> Copiar link</button>
              {link.email && <a className={button} href={`mailto:${encodeURIComponent(link.email)}?subject=${encodeURIComponent('Convite para cotação de compras')}&body=${encodeURIComponent(`Envie sua proposta pelo link individual:\n${link.url}`)}`}><Mail size={14} /> Abrir e-mail</a>}
            </li>)}
          </ul>
      </section>}
      {mode === 'participants' && createdRound && onTrack && <button type="button" className={primary} disabled={busy} onClick={() => onTrack(createdRound)}>Acompanhar cotação</button>}
      {(catalogOnly || showParticipants) && <CatalogContainer className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
        {!catalogOnly && <summary className="cursor-pointer text-sm font-bold">Cadastro de fornecedores</summary>}
        <div className={catalogOnly ? 'min-w-0' : 'mt-3 min-w-0'}>
          <header className="flex flex-wrap items-center justify-between gap-2">
            {catalogOnly && <h1 className="text-xl font-bold text-slate-900">Fornecedores</h1>}
            <button type="button" className={`${catalogOnly ? primary : button} ml-auto`} disabled={busy} onClick={() => setEditing('new')}><Plus size={14} /> Novo fornecedor</button>
          </header>
          {editing && (
            <form key={editing === 'new' ? 'new' : editing.id} onSubmit={saveSupplier} className="mt-3 grid gap-2 border-b border-slate-200 pb-3 sm:grid-cols-2">
              {fields.map(([key, label, max, type, required]) => (
                <label key={key} className="text-xs font-semibold text-slate-700">{label}<input className={input} name={key} type={type} maxLength={max} required={required} defaultValue={editing === 'new' ? '' : editing[key]} /></label>
              ))}
              <label className="text-xs font-semibold text-slate-700">Faturamento mínimo (R$)<input className={input} name="minimum_order" type="number" min="0" step="0.01" required defaultValue={editing === 'new' ? 0 : editing.minimum_order} /></label>
              <label className="text-xs font-semibold text-slate-700">Prazo padrão (dias)<input className={input} name="payment_days" type="number" min="0" max="3650" required defaultValue={editing === 'new' ? 0 : editing.payment_days} /></label>
              <div className="flex flex-wrap gap-2 sm:col-span-2"><button type="submit" disabled={busy} className={primary}>Salvar fornecedor</button><button type="button" disabled={busy} className={button} onClick={() => setEditing(null)}>Cancelar</button></div>
            </form>
          )}
          <ul className={`mt-2 divide-y divide-slate-100 overflow-auto ${catalogOnly ? 'max-h-[65dvh]' : 'max-h-64'}`}>
            {suppliers.map(supplier => <li key={supplier.id} className="flex items-center justify-between gap-2 py-2 text-xs">
              <div className="min-w-0">
                <p className="font-semibold break-words">{supplier.name}</p>
                {supplier.contact.trim() && <p className="break-words text-slate-700">Representante: {supplier.contact}</p>}
                <p className="text-slate-500">{supplier.cnpj} · Mínimo {money.format(supplier.minimum_order)} · {supplier.payment_days} dias</p>
              </div>
              <button type="button" title="Editar fornecedor" aria-label={`Editar ${supplier.name}`} className={button} disabled={busy} onClick={() => setEditing(supplier)}><Pencil size={14} /></button>
            </li>)}
            {!suppliers.length && <li className="py-3 text-xs text-slate-500">{loading ? 'Carregando...' : 'Nenhum fornecedor cadastrado.'}</li>}
          </ul>
        </div>
      </CatalogContainer>}
      {(tracking || (showParticipants && shownInvites.length > 0)) && <section className="rounded-lg border border-slate-200 bg-white">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-3"><h2 className="text-sm font-bold">Convites e respostas</h2><button type="button" className={button} disabled={busy} onClick={() => void run(() => refresh())}>Atualizar</button></header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[630px] text-left text-xs">
            <thead><tr>{['Fornecedor', 'Prazo', 'Status', 'Ações'].map(label => label === 'Ações' ? <th key={label} scope="col" className="p-2">{label}</th> : <SortableTableHeader key={label} column={label} sort={rowSort} className={"p-2"} />)}</tr></thead>
            <tbody>{shownInvites.map(invite => {
              const status = statusFor(invite);
              const supplier = !closed ? suppliers.find(candidate => candidate.id === invite.supplier_id) : undefined;
              return <tr key={invite.id} className="border-t border-slate-100">
              <td className="p-2 font-semibold">{invite.supplier_name}</td><td className="p-2">{formatDate(invite.expires_at)}</td><td className="p-2">{status}</td>
                <td className="p-2"><div className="flex flex-wrap gap-1">
                  {invite.submitted_at ? <button type="button" disabled={busy} className={button} onClick={() => void run(async () => setDetail(await buyerRequest<ReceivedProposal>({ action: 'proposal', id: invite.id })))}>Ver proposta</button> : <>
                    {supplier && <button type="button" className={button} disabled={busy} onClick={() => {
                      if (tracking && !adding) { setAdding(true); setNotice('Defina o novo prazo antes de gerar outro link.'); return; }
                      generateLinks([supplier], true);
                    }}>Gerar novo link</button>}
                    {!closed && !invite.revoked_at && <button type="button" className={button} disabled={busy} onClick={() => {
                      if (!window.confirm('Revogar este link? O fornecedor não poderá mais acessá-lo.')) return;
                      void run(async () => {
                        await buyerRequest({ action: 'revoke', id: invite.id });
                        setLinks(current => current.filter(link => link.supplierId !== invite.supplier_id));
                        await refresh();
                      });
                    }}>Revogar link</button>}
                  </>}
                </div></td>
              </tr>;
            })}</tbody>
          </table>
          {!shownInvites.length && <p className="p-4 text-sm text-slate-500">{loading ? 'Carregando convites...' : 'Nenhum convite gerado.'}</p>}
        </div>
      </section>}
      {!catalogOnly && detail && <section className="rounded-lg border border-slate-200 bg-white p-3">
        <header className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold">Proposta de {detail.supplier_name}</h2><button type="button" className={button} onClick={() => setDetail(null)}>Fechar proposta</button></header>
        <p className="mt-1 text-xs text-slate-600">Enviada em {formatDate(detail.submitted_at)}
          {detail.proposal.paymentDays !== null && ` · Pagamento: ${detail.proposal.paymentDays} dias`}
          {detail.proposal.deliveryDays !== null && ` · Entrega: ${detail.proposal.deliveryDays} dias`}
        </p>
        <p className="mt-2 text-xs font-semibold text-slate-700">{detail.proposal.offers.length} cotados · {unavailableItems.length} indisponíveis · {unansweredCount} sem resposta</p>
        {detail.proposal.note && <p className="mt-1 break-words text-sm">{detail.proposal.note}</p>}
        {detail.proposal.offers.length === 0 ? <p className="mt-2 text-xs text-slate-500">O fornecedor respondeu sem cotar itens.</p> : <ul className="mt-2 max-h-72 divide-y divide-slate-100 overflow-auto">
          {detail.proposal.offers.map(offer => <li key={offer.itemId} className="py-2 text-xs"><p className="font-semibold">{detail.round.supplier_items.find(item => item.id === offer.itemId)?.description}</p><p>{offer.unitPrice === null ? 'Sem preço' : money.format(offer.unitPrice)} por unidade · {offer.available} disponíveis · múltiplo de {offer.multiple}</p>{offer.note && <p className="break-words text-slate-500">{offer.note}</p>}</li>)}
        </ul>}
        {!!unavailableItems.length && <details className="mt-3 border-t border-slate-100 pt-2 text-xs">
          <summary className="cursor-pointer font-semibold text-amber-800">Itens marcados como indisponíveis ({unavailableItems.length})</summary>
          <ul className="mt-2 max-h-48 divide-y divide-slate-100 overflow-auto">
            {unavailableItems.map(item => <li key={item.id} className="py-1.5">{item.description} · {item.ean}</li>)}
          </ul>
        </details>}
      </section>}
    </div>
  );
}
