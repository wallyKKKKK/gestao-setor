'use client';

import { SortableTableHeader, useColumnSort } from '@/app/components/table-sort';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CheckCircle2, FileUp, Save, Send } from 'lucide-react';
import type { SupplierItem, SupplierProposal } from '@/lib/purchase-quotation-supplier';
import { readSupplierPriceFile } from '@/lib/supplier-quotation-price-import';

type Invitation = {
  supplier: string; expiresAt: string; submittedAt: string | null; revision: number;
  items: SupplierItem[]; defaultPaymentDays: number; proposal: SupplierProposal | null;
};
type OfferFields = { price: string; available: string; multiple: string; note: string; status: 'unspecified' | 'available' | 'unavailable' };
const blankOffer: OfferFields = { price: '', available: '', multiple: '1', note: '', status: 'unspecified' };
const fieldClass = 'w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 py-2 text-sm disabled:bg-slate-50';
const gridCell = 'border-b border-r border-slate-200 last:border-r-0';
const editableCell = `${gridCell} focus-within:bg-emerald-50 focus-within:ring-2 focus-within:ring-inset focus-within:ring-emerald-600 dark:focus-within:bg-emerald-950`;
const gridField = 'block h-9 w-full min-w-0 bg-transparent px-2 outline-none disabled:bg-slate-100 disabled:text-slate-500';
const offerColumns = ['status', 'price', 'available', 'multiple', 'note'] as const;
type OfferColumn = typeof offerColumns[number];
const pageSize = 50;
const number = new Intl.NumberFormat('pt-BR');

export function SupplierQuotationPortal() {
  const [invite, setInvite] = useState<Invitation | null>(null);
  const [token, setToken] = useState('');
  const [offers, setOffers] = useState<Record<string, OfferFields>>({});
  const [payment, setPayment] = useState('');
  const [delivery, setDelivery] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ filled: number; replaced: number; kept: number; unavailable: number; ignored: number; examples: string[] } | null>(null);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const tableRef = useRef<HTMLTableElement>(null);
  const pendingFocus = useRef<{ index: number; column: OfferColumn } | null>(null);
  const [sortSnapshot, setSortSnapshot] = useState<Record<string, OfferFields> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const key = window.location.hash.slice(1);
      if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('Abra o link individual enviado pelo comprador.');
      const response = await fetch('/api/purchase-quotation/respond', { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store', signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível abrir a cotação.');
      const loaded = result as Invitation;
      if (controller.signal.aborted) return;
      setToken(key);
      setInvite(loaded);
      setPayment(String(loaded.proposal ? loaded.proposal.paymentDays ?? '' : loaded.defaultPaymentDays));
      setDelivery(String(loaded.proposal?.deliveryDays ?? ''));
      setNote(loaded.proposal?.note ?? '');
      setOffers(Object.fromEntries([
        ...(loaded.proposal?.offers ?? []).map(row => [row.itemId, {
          price: String(row.unitPrice ?? '').replace('.', ','), available: String(row.available ?? ''), multiple: String(row.multiple ?? ''), note: row.note, status: 'available',
        }] as const),
        ...(loaded.proposal?.unavailableItemIds ?? []).map(itemId => [itemId, { ...blankOffer, status: 'unavailable' }] as const),
      ]));
    }
    void load().catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a cotação.'); });
    return () => controller.abort();
  }, []);

  const importPrices = async (file: File) => {
    if (!invite || busy || importing || invite.submittedAt) return;
    setImporting(true);
    setImportResult(null);
    setError('');
    setNotice('');
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('O arquivo deve ter até 5 MB.');
      const result = await readSupplierPriceFile(await file.arrayBuffer(), file.name, invite.items);
      const eligible = result.prices.filter(({ itemId }) => offers[itemId]?.status !== 'unavailable');
      const alreadyFilled = eligible.filter(({ itemId, price }) => {
        const previous = offers[itemId]?.price.trim();
        return previous && Number(previous.replace(',', '.')) !== price;
      });
      const replace = alreadyFilled.length > 0 && window.confirm(`Substituir ${alreadyFilled.length} preços já preenchidos? Se cancelar, apenas os preços em branco serão preenchidos.`);
      const fill = eligible.filter(({ itemId }) => !offers[itemId]?.price.trim());
      const changes = replace ? [...fill, ...alreadyFilled] : fill;
      setOffers(current => {
        const next = { ...current };
        for (const { itemId, price } of changes) {
          next[itemId] = { ...blankOffer, ...current[itemId], price: String(price).replace('.', ','), status: 'available' };
        }
        return next;
      });
      setImportResult({ filled: fill.length, replaced: replace ? alreadyFilled.length : 0, kept: replace ? 0 : alreadyFilled.length, unavailable: result.prices.length - eligible.length, ignored: result.ignored, examples: result.examples });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível importar os preços.');
    } finally {
      setImporting(false);
    }
  };

  const persist = async (submit: boolean) => {
    if (!invite || busy || importing || invite.submittedAt) return;
    const unavailableItemIds = invite.items.filter(item => offers[item.id]?.status === 'unavailable').map(item => item.id);
    const quoted = invite.items.flatMap(item => {
      const row = offers[item.id];
      if (!row || row.status === 'unavailable' || !(row.status === 'available' || row.price.trim() || row.available || row.note.trim() || row.multiple !== '1')) return [];
      const price = !row.price.trim() ? null : /^\d+(?:[.,]\d{1,4})?$/.test(row.price.trim()) ? Number(row.price.trim().replace(',', '.')) : 0;
      return [{ itemId: item.id, unitPrice: price, available: row.available.trim() ? Number(row.available) : null, multiple: row.multiple.trim() ? Number(row.multiple) : null, note: row.note }];
    });
    const validQuantity = (value: number | null) => value === null ? !submit : Number.isInteger(value) && value >= 1;
    const invalid = quoted.find(row => (row.unitPrice === null ? submit : row.unitPrice <= 0) || !validQuantity(row.available) || !validQuantity(row.multiple));
    if (invalid) {
      setError(`Confira o preço, a quantidade e o múltiplo de ${invite.items.find(item => item.id === invalid.itemId)?.description ?? 'um dos itens'}.`);
      return;
    }
    if (submit && quoted.length && (!delivery.trim() || !payment.trim())) { setError('Informe os prazos de entrega e pagamento antes de enviar.'); return; }
    if (submit && !window.confirm(`Enviar resposta definitiva? ${quoted.length} item(ns) cotado(s), ${unavailableItemIds.length} indisponível(is) e ${invite.items.length - quoted.length - unavailableItemIds.length} sem resposta.`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/purchase-quotation/respond', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: submit ? 'submit' : 'save', revision: invite.revision, proposal: {
          offers: quoted, unavailableItemIds, paymentDays: payment === '' ? null : Number(payment), deliveryDays: delivery === '' ? null : Number(delivery), note,
        } }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível salvar a proposta.');
      setInvite({ ...invite, revision: result.revision, submittedAt: result.submittedAt });
      setImportResult(null);
      setNotice(submit ? 'Proposta enviada.' : 'Rascunho salvo.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.');
    } finally { setBusy(false); }
  };

  const visible = invite?.items.filter(item => `${item.description} ${item.ean} ${item.code}`.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR'))) ?? [];
  const rowSort = useColumnSort();
  const sorted = rowSort.sortRowsBy(visible, item => {
    const values = (sortSnapshot ?? offers)[item.id] ?? blankOffer;
    return ({
      Produto: item.description, 'Qtd. solicitada': item.quantity,
      Disponibilidade: { unspecified: 'Não informado', available: 'Tenho', unavailable: 'Não tenho' }[values.status],
      'Preço unitário (R$)': values.price ? Number(values.price.replace(',', '.')) : '',
      'Qtd. disponível': values.available ? Number(values.available) : '',
      'Múltiplo': values.multiple ? Number(values.multiple) : '', 'Observação': values.note,
    });
  });
  const readonly = busy || importing || !!invite?.submittedAt;
  const setField = (itemId: string, patch: Partial<OfferFields>) => setOffers(current => ({ ...current, [itemId]: { ...blankOffer, ...current[itemId], ...patch } }));

  function focusOffer(index: number, column: OfferColumn) {
    const control = tableRef.current?.querySelector<HTMLInputElement | HTMLSelectElement>(
      `tr[data-offer-index="${index}"] [data-offer-column="${column}"]:not(:disabled)`,
    );
    control?.focus();
    if (control instanceof HTMLInputElement) control.select();
  }

  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const { index, column } = pendingFocus.current;
    pendingFocus.current = null;
    focusOffer(index, column);
  }, [page]);

  function navigateOffers(event: KeyboardEvent<HTMLTableElement>) {
    const target = event.target;
    if (readonly || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
      !(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const column = target.dataset.offerColumn as OfferColumn;
    const columnIndex = offerColumns.indexOf(column);
    const index = Number(target.closest('tr')?.dataset.offerIndex);
    if (columnIndex < 0 || !Number.isInteger(index)) return;

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (event.shiftKey) return;
      const left = event.key === 'ArrowLeft';
      if (target instanceof HTMLInputElement) {
        const wholeValueSelected = target.selectionStart === 0 && target.selectionEnd === target.value.length;
        const edge = left ? 0 : target.value.length;
        if (!wholeValueSelected && (target.selectionStart !== edge || target.selectionEnd !== edge)) return;
      }
      const nextColumn = offerColumns[columnIndex + (left ? -1 : 1)];
      if (!nextColumn) return;
      event.preventDefault();
      focusOffer(index, nextColumn);
      return;
    }

    if (!(target instanceof HTMLInputElement) || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Enter')) return;
    event.preventDefault();
    const step = event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey) ? -1 : 1;
    for (let next = index + step; next >= 0 && next < sorted.length; next += step) {
      if (offers[sorted[next].id]?.status === 'unavailable') continue;
      const nextPage = Math.floor(next / pageSize);
      if (nextPage === page) focusOffer(next, column);
      else {
        pendingFocus.current = { index: next, column };
        setPage(nextPage);
      }
      break;
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-screen-2xl space-y-4 px-3 py-6 sm:px-6">
      <h1 className="text-xl font-bold text-slate-900">Cotação de compras</h1>
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!invite ? (!error && <p role="status" className="text-sm text-slate-600">Carregando cotação...</p>) : <>
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <div className="min-w-0"><h2 className="break-words font-semibold">{invite.supplier}</h2><p className="break-words text-sm text-slate-600">Prazo: {new Date(invite.expiresAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Fortaleza' })} (Fortaleza)</p></div>
          {invite.submittedAt && <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-sm font-semibold text-emerald-700"><CheckCircle2 size={16} /> Proposta enviada</span>}
        </header>
        <div className="grid gap-2 text-sm sm:grid-cols-[1fr_1fr_2fr]">
          <label>Prazo de pagamento (dias)<input className={fieldClass} type="number" min="0" max="3650" value={payment} disabled={readonly} onChange={event => setPayment(event.target.value)} /></label>
          <label>Prazo de entrega (dias)<input className={fieldClass} type="number" min="0" max="3650" value={delivery} disabled={readonly} onChange={event => setDelivery(event.target.value)} /></label>
          <label>Observação geral<input className={fieldClass} maxLength={1000} value={note} disabled={readonly} onChange={event => setNote(event.target.value)} /></label>
        </div>
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label="Itens solicitados">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-2">
            <input className={`${fieldClass} max-w-xs`} placeholder="Buscar item, código ou EAN" aria-label="Buscar item" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} />
            {!invite.submittedAt && <label title="XLSX ou CSV com as colunas EAN e Custo" className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold focus-within:outline-2 focus-within:outline-emerald-600 has-[:disabled]:opacity-50">
              <FileUp size={16} aria-hidden="true" /> {importing ? 'Importando...' : 'Importar preços'}
              <input type="file" accept=".xlsx,.csv" aria-label="Importar preços (EAN e custo)" className="sr-only" disabled={readonly} onChange={event => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void importPrices(file);
              }} />
            </label>}
          </div>
          {importResult && <div className="border-b border-slate-200 px-3 py-2 text-xs text-slate-700">
            <p role="status">
              {importResult.filled} preços preenchidos · {importResult.replaced} substituídos · {importResult.ignored} linhas ignoradas
              {importResult.kept > 0 && ` · ${importResult.kept} preços anteriores preservados`}
              {importResult.unavailable > 0 && ` · ${importResult.unavailable} itens marcados como Não tenho preservados`}
              {(importResult.filled > 0 || importResult.replaced > 0) && ' · Ainda não salvo'}
            </p>
            {!!importResult.examples.length && <details className="mt-1">
              <summary className="cursor-pointer font-semibold">Ver linhas ignoradas</summary>
              <ul className="mt-1 list-inside list-disc">{importResult.examples.map(example => <li key={example}>{example}</li>)}</ul>
              {importResult.ignored > importResult.examples.length && <p>Mostrando as primeiras {importResult.examples.length} ocorrências.</p>}
            </details>}
          </div>}
          <div className="max-h-[65dvh] overflow-auto">
            <table ref={tableRef} onKeyDown={navigateOffers} className="w-full min-w-[880px] table-fixed border-separate border-spacing-0 text-left text-sm"
              onFocusCapture={event => { if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) setSortSnapshot(current => current ?? offers); }}
              onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget) && !pendingFocus.current) setSortSnapshot(null); }}>
              <colgroup><col className="w-[29%]" /><col className="w-[9%]" /><col className="w-[14%]" /><col className="w-[13%]" /><col className="w-[11%]" /><col className="w-[8%]" /><col className="w-[16%]" /></colgroup>
              <thead className="sticky top-0 z-10 bg-slate-50"><tr>{['Produto', 'Qtd. solicitada', 'Disponibilidade', 'Preço unitário (R$)', 'Qtd. disponível', 'Múltiplo', 'Observação'].map(label => <SortableTableHeader key={label} column={label} sort={rowSort} className={`${gridCell} px-2 py-2 text-xs`} />)}</tr></thead>
              <tbody>{sorted.slice(page * pageSize, (page + 1) * pageSize).map((item, index) => {
                const values = offers[item.id] ?? blankOffer;
                return <tr key={item.id} data-offer-index={page * pageSize + index} className="odd:bg-white even:bg-slate-50 focus-within:[&>td]:border-b-emerald-500">
                  <td className={`${gridCell} px-2 py-1`}><p className="break-words font-semibold leading-tight">{item.description}</p><p className="text-xs text-slate-500">{item.code} · {item.ean}</p></td>
                  <td className={`${gridCell} px-2 text-center tabular-nums`}>{number.format(item.quantity)}</td>
                  <td className={editableCell}>
                    <select data-offer-column="status" className={gridField} aria-label={`Disponibilidade: ${item.description}`} value={values.status} disabled={readonly} onChange={event => {
                      const status = event.target.value as OfferFields['status'];
                      setField(item.id, status === 'unspecified' ? blankOffer : { status });
                    }}>
                      <option value="unspecified">Não informado</option>
                      <option value="available">Tenho</option>
                      <option value="unavailable">Não tenho</option>
                    </select>
                  </td>
                  {([['price', 'Preço', 'decimal'], ['available', 'Quantidade disponível', 'numeric'], ['multiple', 'Múltiplo', 'numeric'], ['note', 'Observação', 'text']] as const).map(([key, label, mode]) => (
                    <td key={key} className={editableCell}><input data-offer-column={key} className={`${gridField} ${key === 'note' ? '' : 'text-center tabular-nums'}`} inputMode={mode} maxLength={key === 'note' ? 300 : 16} disabled={readonly || values.status === 'unavailable'} aria-label={`${label}: ${item.description}`} value={values.status === 'unavailable' ? '' : values[key]} onChange={event => setField(item.id, { [key]: event.target.value, status: 'available' })} /></td>
                  ))}
                </tr>;
              })}</tbody>
            </table>
            {!visible.length && <p className="p-4 text-sm text-slate-500">Nenhum item encontrado.</p>}
          </div>
          {visible.length > pageSize && <nav aria-label="Páginas de itens" className="flex flex-wrap justify-end gap-2 border-t border-slate-200 p-2 text-xs">
            <span className="self-center">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, visible.length)} de {visible.length}</span>
            <button className="rounded border border-slate-200 px-3 py-1 disabled:opacity-50" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
            <button className="rounded border border-slate-200 px-3 py-1 disabled:opacity-50" disabled={(page + 1) * pageSize >= visible.length} onClick={() => setPage(page + 1)}>Próxima</button>
          </nav>}
        </section>
        <footer className="flex flex-wrap items-center justify-end gap-2">
          {notice && <span role="status" className="text-sm font-semibold text-emerald-700">{notice}</span>}
          {!invite.submittedAt && <>
            <button type="button" disabled={readonly} onClick={() => void persist(false)} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"><Save size={16} /> Salvar rascunho</button>
            <button type="button" disabled={readonly} onClick={() => void persist(true)} className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Send size={16} /> Enviar proposta</button>
          </>}
        </footer>
      </>}
    </main>
  );
}
