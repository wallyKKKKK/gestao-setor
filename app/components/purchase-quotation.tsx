'use client';

import { SortableTableHeader, useColumnSort } from '@/app/components/table-sort';

import { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, FileSpreadsheet, FileUp, Plus, Save, Search } from 'lucide-react';
import { PurchaseQuotationSuppliers } from '@/app/components/purchase-quotation-suppliers';
import { PurchaseQuotationSettlement } from '@/app/components/purchase-quotation-settlement';
import { QuotationSummary } from '@/app/components/purchase-quotation-summary';
import { PurchaseQuotationList } from '@/app/components/purchase-quotation-list';
import { quotationNextStage, type QuotationRoundIdentity, type QuotationWorkflowStage } from '@/lib/purchase-quotation-workflow';
import { createQuotationWorkspace, emptyQuotationDraft, loadQuotationDraft, QuotationDraftConflict, saveQuotationDraft, type QuotationDraftSession } from '@/lib/purchase-quotation-draft';
import { findQuotationCostLinks, normalizeQuotationDescription, parseA7Quotation, parseQuotationCostRows, reviewQuotation, type QuotationDraft } from '@/lib/purchase-quotation-import';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 });
const number = new Intl.NumberFormat('pt-BR');
const PAGE_SIZE = 100;
const dateBR = (iso: string) => iso.split('-').reverse().join('/');
const actionClass = 'inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:border-emerald-500 focus-within:outline-2 focus-within:outline-emerald-600 has-[:disabled]:cursor-wait has-[:disabled]:opacity-60';
const primary = 'inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50';
type Screen = 'home' | 'products' | 'participants' | 'suppliers' | QuotationWorkflowStage;

export function PurchaseQuotation({ session, onSessionChange }: {
  session: QuotationDraftSession | null;
  onSessionChange: (update: (current: QuotationDraftSession | null) => QuotationDraftSession | null) => void;
}) {
  const draft = session?.draft ?? emptyQuotationDraft;
  const [busy, setBusy] = useState<'request' | 'costs' | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const [published, setPublished] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [summaryVersion, setSummaryVersion] = useState(0);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [onlyPending, setOnlyPending] = useState(false);
  const [view, setView] = useState<'items' | 'links'>('items');
  const [page, setPage] = useState(0);
  const [screen, setScreen] = useState<Screen>('home');
  const [inviteRevision, setInviteRevision] = useState<number | null>(null);
  const [activeRound, setActiveRound] = useState<(QuotationRoundIdentity & { closedAt?: string | null }) | null>(null);
  const [settlementRoundId, setSettlementRoundId] = useState('');
  const [settlementDirty, setSettlementDirty] = useState(false);
  const review = useMemo(() => reviewQuotation(draft), [draft]);
  const pending = review.rows.filter(row => !row.ean || row.duplicate || !row.cost).length;
  const pendingProducts = new Set(review.rows.filter(row => !row.ean || row.duplicate || !row.cost).map(row => row.productCode)).size;
  const search = normalizeQuotationDescription(query);
  const visible = review.rows.filter(row =>
    (!onlyPending || !row.ean || row.duplicate || !row.cost)
    && (!search || normalizeQuotationDescription(`${row.description} ${row.productCode} ${row.ean} ${row.branchCnpj}`).includes(search)));
  const visibleLinks = findQuotationCostLinks(review.links, query);
  const itemSort = useColumnSort();
  const linkSort = useColumnSort();
  const sortedItems = itemSort.sortRowsBy(visible, row => ({
    Produto: row.description, 'CNPJ da loja': row.branchCnpj, Quantidade: row.quantity, 'Referência A7': row.a7Reference,
    'Último custo unitário por data da NF': row.cost?.unitCost, 'Pendências': Number(!row.ean) + Number(row.duplicate) + Number(!row.cost),
  }));
  const sortedLinks = linkSort.sortRows(visibleLinks, (link, column) => column === 'description' ? link.description : review.products.get(link.code || '') || link.code);
  const resultCount = view === 'items' ? visible.length : visibleLinks.length;
  const lastPage = Math.max(0, Math.ceil(resultCount / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const pageStart = currentPage * PAGE_SIZE;
  const locked = !session || saving || busy !== null;
  const hasInvalidItems = review.rows.some(row => !row.ean || row.duplicate);
  const inRound = screen === 'tracking' || screen === 'settlement' || screen === 'orders';
  const showingOrders = screen === 'orders' || (screen === 'settlement' && Boolean(activeRound?.closedAt));
  const workRoundId = screen === 'participants' ? session?.id : activeRound?.id;
  const markClosed = useCallback((roundId: string, closedAt: string) => {
    setActiveRound(current => current?.id === roundId && current.closedAt !== closedAt ? { ...current, closedAt } : current);
  }, []);

  const openRound = (round: QuotationRoundIdentity & { closedAt?: string | null }, stage: QuotationWorkflowStage) => {
    if (activeRound?.id !== round.id && settlementDirty && !window.confirm('Descartar as alterações ainda não salvas na apuração anterior?')) return;
    if (activeRound?.id !== round.id) setSettlementDirty(false);
    setActiveRound(round);
    if (stage !== 'tracking') setSettlementRoundId(round.id);
    setScreen(stage);
  };

  const onDraftChange = (update: (current: QuotationDraft) => QuotationDraft) => {
    onSessionChange(current => current && { ...current, draft: update(current.draft), dirty: true });
  };

  const saveDraft = async (): Promise<number | null> => {
    if (!session || locked || conflict) return null;
    if (!session.dirty) return session.revision;
    setSaving(true);
    setError('');
    try {
      const revision = await saveQuotationDraft(session);
      onSessionChange(current => current?.id === session.id ? { ...current, revision, dirty: current.draft !== session.draft } : current);
      return revision;
    } catch (cause) {
      setConflict(cause instanceof QuotationDraftConflict);
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o rascunho.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const openDraft = async (id?: string, reload = false) => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setError('');
    try {
      if (!reload && session?.dirty && session.id !== id && await saveDraft() === null) return;
      const next = !id ? await createQuotationWorkspace()
        : !reload && session?.id === id && session.dirty ? session : await loadQuotationDraft(id);
      onSessionChange(() => next);
      setActiveRound(null); setSettlementRoundId(''); setSettlementDirty(false);
      setInviteRevision(null); setPublished(false); setConflict(false);
      setQuery(''); setPage(0); setOnlyPending(false); setView('items');
      setScreen('products');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível abrir a cotação.');
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  };

  const returnHome = async () => {
    if (screen === 'products' && session?.dirty && await saveDraft() === null) {
      if (!window.confirm('O rascunho não foi salvo. Voltar e descartar as alterações locais?')) return;
      onSessionChange(() => null);
    }
    if (published) onSessionChange(() => null);
    setError('');
    setScreen('home');
  };

  const continueToParticipants = async () => {
    if (!review.rows.length || hasInvalidItems) return;
    const revision = await saveDraft();
    if (revision === null) return;
    setInviteRevision(revision);
    setScreen('participants');
  };

  const importFile = async (kind: 'request' | 'costs', file: File) => {
    if (locked) return;
    setBusy(kind);
    setError('');
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('O arquivo deve ter até 20 MB.');
      const buffer = await file.arrayBuffer();
      if (kind === 'request') {
        const rows = parseA7Quotation(buffer);
        onDraftChange(current => ({ ...current, request: { name: file.name, rows }, links: {}, chosenCosts: {} }));
        setView('items');
      } else {
        const xlsx = await import('xlsx');
        const workbook = xlsx.read(buffer, { type: 'array', dateNF: 'dd/mm/yyyy' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) throw new Error('A planilha está vazia.');
        const grid = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false, dateNF: 'dd/mm/yyyy' });
        const result = parseQuotationCostRows(grid);
        if (!result.rows.length && !result.transfers && !result.issues.length) throw new Error('A planilha não contém registros de custo.');
        onDraftChange(current => ({ ...current, costs: { name: file.name, ...result }, chosenCosts: {} }));
      }
      setPage(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível ler o arquivo.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className={`mx-auto w-full space-y-4 px-3 py-5 sm:px-6 ${screen === 'home' ? '' : 'max-w-[1680px]'}`}>
      {screen === 'home' ? (
        <header className="mx-auto w-full max-w-7xl space-y-3 border-b border-slate-200 pb-4">
          <h1 className="text-xl font-bold text-slate-900">Cotações de compras</h1>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={opening || saving} onClick={() => void openDraft()}><Plus size={16} /> Nova cotação</button>
            <button type="button" className={actionClass} disabled={opening || saving} onClick={() => setScreen('suppliers')}>Fornecedores</button>
          </div>
          {opening && <p role="status" className="text-xs text-slate-600">Abrindo cotação...</p>}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </header>
      ) : (
        <nav aria-label="Cotações de compras" className="flex flex-wrap items-center gap-3 border-b border-slate-200 pb-2">
          <button type="button" className={actionClass} disabled={opening || saving || generating || busy !== null} onClick={() => void returnHome()}><ArrowLeft size={14} /> Cotações</button>
          {(screen === 'products' || screen === 'participants') && <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-slate-600">
            <li aria-current={screen === 'products' ? 'step' : undefined} className={screen === 'products' ? 'text-emerald-800' : ''}>1. Produtos</li>
            <li aria-current={screen === 'participants' ? 'step' : undefined} className={screen === 'participants' ? 'text-emerald-800' : ''}>2. Representantes</li>
          </ol>}
          {screen === 'participants' && !published && <button type="button" className={`${actionClass} sm:ml-auto`} disabled={generating} onClick={() => setScreen('products')}><ArrowLeft size={14} /> Voltar aos produtos</button>}
        </nav>
      )}
      {screen === 'home' && <>
        <PurchaseQuotationList disabled={opening || saving} onOpen={round => {
          const stage = quotationNextStage(round);
          if (stage === 'products') void openDraft(round.id);
          else openRound(round, stage);
        }} onDeleted={id => {
          onSessionChange(current => current?.id === id ? null : current);
          if (activeRound?.id === id) { setActiveRound(null); setSettlementRoundId(''); setSettlementDirty(false); }
          setSummaryVersion(current => current + 1);
        }} />
        <QuotationSummary key={summaryVersion} onSuppliers={() => setScreen('suppliers')} />
      </>}
      {inRound && activeRound && <header className="space-y-2 border-b border-slate-200 pb-3">
        <div>
          <p className="text-xs font-semibold text-slate-600">Cotação {activeRound.draft_revision}{activeRound.closedAt ? ' · Finalizada' : ''}</p>
          <h1 className="break-words text-xl font-bold text-slate-900">{activeRound.title}</h1>
        </div>
        <nav aria-label="Etapas da cotação" className="flex flex-wrap items-center gap-2">
          <span className="px-2 text-xs font-semibold text-slate-600">1. Preparada</span>
          <button type="button" className={screen === 'tracking' ? primary : actionClass} aria-current={screen === 'tracking' ? 'step' : undefined}
            onClick={() => openRound(activeRound, 'tracking')}>2. Acompanhar</button>
          {activeRound.closedAt ? <span className="px-2 text-xs font-semibold text-slate-600">3. Apurada</span> :
            <button type="button" className={screen === 'settlement' ? primary : actionClass} aria-current={screen === 'settlement' ? 'step' : undefined}
              onClick={() => openRound(activeRound, 'settlement')}>3. Apurar</button>}
          {activeRound.closedAt ? <button type="button" className={showingOrders ? primary : actionClass} aria-current={showingOrders ? 'step' : undefined}
            onClick={() => openRound(activeRound, 'orders')}>4. Pedidos</button> : <span className="px-2 text-xs font-semibold text-slate-600">4. Pedidos</span>}
        </nav>
      </header>}
      {screen === 'suppliers' && <PurchaseQuotationSuppliers revision={null} mode="catalog" />}
      {workRoundId && (inRound || screen === 'participants') && <div hidden={screen !== 'participants' && screen !== 'tracking'}>
        <PurchaseQuotationSuppliers key={workRoundId} revision={screen === 'participants' ? inviteRevision : null} mode={screen === 'participants' ? 'participants' : 'tracking'}
          roundId={workRoundId} closed={screen === 'participants' ? false : Boolean(activeRound?.closedAt)}
          onGenerating={setGenerating}
          onPublished={() => { if (screen === 'participants') setPublished(true); }}
          onTrack={round => openRound(round, 'tracking')} />
      </div>}
      {activeRound && settlementRoundId === activeRound.id && <PurchaseQuotationSettlement key={activeRound.id} roundId={activeRound.id}
        active={screen === 'settlement' || screen === 'orders'} onDirtyChange={setSettlementDirty} onClosed={markClosed} />}
      {screen === 'products' && <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">Produtos da cotação</h1>
        <div className="flex flex-wrap gap-2">
          <label className={actionClass}>
            <FileUp size={16} aria-hidden="true" /> {busy === 'request' ? 'Lendo TXT...' : 'Importar TXT do A7'}
            <input type="file" className="sr-only" accept=".txt" disabled={locked} onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void importFile('request', file);
            }} />
          </label>
          <label className={actionClass}>
            <FileSpreadsheet size={16} aria-hidden="true" /> {busy === 'costs' ? 'Lendo planilha...' : 'Importar custos'}
            <input type="file" className="sr-only" accept=".xlsx,.xls" disabled={locked} onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void importFile('costs', file);
            }} />
          </label>
          <button type="button" onClick={() => void saveDraft()} disabled={locked || !session?.dirty || conflict} className={actionClass}>
            <Save size={16} aria-hidden="true" /> {saving ? 'Salvando...' : 'Salvar rascunho'}
          </button>
          <button type="button" className={primary} disabled={locked || conflict || !review.rows.length || hasInvalidItems} onClick={() => void continueToParticipants()}>
            Escolher representantes <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {hasInvalidItems && <p className="text-xs font-medium text-amber-800">Corrija os itens sem EAN ou duplicados na mesma loja antes de escolher os representantes.</p>}
      {conflict && <button type="button" onClick={() => {
        if (!window.confirm('Carregar a versão salva e descartar as alterações locais?')) return;
        if (session) void openDraft(session.id, true);
      }} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">Carregar versão salva</button>}
      <p role="status" className="text-xs font-medium text-slate-600">
        {saving ? 'Salvando rascunho...' : session?.dirty ? 'Alterações não salvas' : 'Rascunho salvo'}
      </p>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="min-w-0 border-l-2 border-emerald-600 px-3 py-1 text-slate-600">
          <p className="truncate font-semibold text-slate-900" title={draft.request?.name}>{draft.request?.name ?? 'Nenhum TXT importado'}</p>
          <p>{number.format(review.rows.length)} linhas · {number.format(review.products.size)} produtos · {new Set(review.rows.map(row => row.branchCnpj)).size} lojas</p>
        </div>
        <div className="min-w-0 border-l-2 border-emerald-600 px-3 py-1 text-slate-600">
          <p className="truncate font-semibold text-slate-900" title={draft.costs?.name}>{draft.costs?.name ?? 'Nenhuma planilha de custos importada'}</p>
          <p>{number.format(draft.costs?.rows.length ?? 0)} custos válidos · {number.format(draft.costs?.transfers ?? 0)} transferências ignoradas</p>
        </div>
      </div>

      {!!draft.costs?.issues.length && (
        <details className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <summary className="cursor-pointer font-semibold">{draft.costs.issues.length} linhas de custo ignoradas</summary>
          <ul className="mt-2 max-h-36 list-inside list-disc overflow-auto">{draft.costs.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
        </details>
      )}

      <section aria-label="Conferência da cotação" className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-2">
          {([['items', `Itens da cotação (${review.rows.length})`], ['links', 'Vínculos de custo']] as const).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={view === id} onClick={() => { setView(id); setQuery(''); setPage(0); }} className={`rounded-md px-3 py-2 text-xs font-semibold ${view === id ? 'bg-emerald-50 text-emerald-800 dark:text-emerald-300' : 'text-slate-600 hover:bg-slate-50'}`}>{label}</button>
          ))}
            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:ml-auto">
              {view === 'items' && <label className="flex items-center gap-1.5 px-2 text-xs text-slate-600" title={`${pending} linhas com pendências`}><input type="checkbox" checked={onlyPending} onChange={event => { setOnlyPending(event.target.checked); setPage(0); }} /> Só pendências ({pendingProducts} {pendingProducts === 1 ? 'produto' : 'produtos'})</label>}
              <label className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-slate-600">
                <Search size={14} aria-hidden="true" />
                <input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} aria-label={view === 'items' ? 'Buscar itens da cotação' : 'Buscar vínculos por descrição'} placeholder={view === 'items' ? 'Buscar item, EAN ou loja' : 'Buscar descrição'} className="min-w-0 bg-transparent text-xs outline-none" />
              </label>
            </div>
        </div>
        <div className="max-h-[65dvh] overflow-auto">
          {view === 'items' ? (
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="bg-slate-50 text-slate-600"><tr>{['Produto', 'CNPJ da loja', 'Quantidade', 'Referência A7', 'Último custo unitário por data da NF', 'Pendências'].map(label => <SortableTableHeader key={label} column={label} sort={itemSort} className={"px-3 py-2"} />)}</tr></thead>
              <tbody>
                {sortedItems.slice(pageStart, pageStart + PAGE_SIZE).map(row => (
                  <tr key={row.line} className="border-t border-slate-100">
                    <td className="px-3 py-2"><p className="font-semibold">{row.description}</p><p className="text-slate-500">{row.productCode} · {row.ean || 'Sem EAN'}</p></td>
                    <td className="px-3 py-2 tabular-nums">{row.branchCnpj}</td>
                    <td className="px-3 py-2 tabular-nums">{number.format(row.quantity)}</td>
                    <td className="px-3 py-2 tabular-nums">{money.format(row.a7Reference)}</td>
                    <td className="px-3 py-2">
                      {row.candidates.length > 0 && new Set(row.candidates.map(candidate => candidate.unitCost)).size > 1 ? (
                        <select aria-label={`Revisar custo de ${row.description}`} disabled={locked} value={row.cost?.line ?? ''} onChange={event => {
                          const line = Number(event.target.value);
                          onDraftChange(current => ({ ...current, chosenCosts: { ...current.chosenCosts, [row.productCode]: line } }));
                        }} className="max-w-64 rounded-md border border-slate-200 bg-white p-1.5">
                          <option value="">Escolher custo da última data</option>
                          {row.candidates.map(candidate => <option key={candidate.line} value={candidate.line}>{money.format(candidate.unitCost)} · Loja {candidate.branchCode} · {candidate.supplier}</option>)}
                        </select>
                      ) : row.cost ? <><p className="font-semibold">{money.format(row.cost.unitCost)}</p><p className="text-slate-500">{dateBR(row.cost.invoiceDate)} · Loja {row.cost.branchCode} · {row.cost.supplier}</p></> : '-'}
                    </td>
                    <td className="px-3 py-2 text-amber-800">{[!row.ean && 'Sem EAN', row.duplicate && 'Duplicado na loja', !row.cost && (row.candidates.length ? 'Custos divergentes na última data' : 'Sem referência de custo')].filter(Boolean).join(' · ') || '-'}</td>
                  </tr>
                ))}
                {!visible.length && <tr><td colSpan={6} className="px-3 py-9 text-center text-sm text-slate-500">{draft.request ? 'Nenhum item para os filtros selecionados.' : 'Importe o TXT de ida da Cotação Externa do A7.'}</td></tr>}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-[550px] text-left text-xs">
              <thead className="bg-slate-50 text-slate-600"><tr><SortableTableHeader column="description" sort={linkSort} className="px-3 py-2">Descrição na planilha de custos</SortableTableHeader><SortableTableHeader column="product" sort={linkSort} className="px-3 py-2">Produto na cotação</SortableTableHeader></tr></thead>
              <tbody>
                {sortedLinks.slice(pageStart, pageStart + PAGE_SIZE).map(link => (
                  <tr key={link.key} className="border-t border-slate-100">
                    <td className="px-3 py-2"><p className="font-semibold">{link.description}</p>{!link.code && <p className="text-amber-800">{link.ambiguous ? 'Mais de um produto com essa descrição' : 'Sem correspondência exata'}</p>}</td>
                    <td className="px-3 py-2">
                      {draft.request ? <select aria-label={`Vincular ${link.description}`} disabled={locked} value={draft.links[link.key] || ''} onChange={event => {
                        const code = event.target.value;
                        onDraftChange(current => ({ ...current, links: { ...current.links, [link.key]: code }, chosenCosts: {} }));
                      }} className="max-w-full rounded-md border border-slate-200 bg-white p-1.5">
                        <option value="">{link.code && !draft.links[link.key] ? `Automático: ${link.code} - ${review.products.get(link.code)}` : 'Vínculo automático, se houver'}</option>
                        {Array.from(review.products, ([code, name]) => <option key={code} value={code}>{code} - {name}</option>)}
                      </select> : <span className="text-slate-500">Aguardando o TXT da cotação</span>}
                    </td>
                  </tr>
                ))}
                {!visibleLinks.length && <tr><td colSpan={2} className="px-3 py-9 text-center text-sm text-slate-500">{search ? 'Nenhum custo para essa busca.' : draft.request && draft.costs ? 'Nenhum vínculo na cotação. Busque pela descrição da planilha.' : 'Importe o TXT e a planilha de custos para conferir os vínculos.'}</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        {lastPage > 0 && (
          <nav aria-label="Paginação da cotação" className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 p-2 text-xs text-slate-600">
            <span>{pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, resultCount)} de {resultCount}</span>
            <button type="button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)} className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-40">Anterior</button>
            <button type="button" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)} className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-40">Próxima</button>
          </nav>
        )}
      </section>
      </>}
    </main>
  );
}
