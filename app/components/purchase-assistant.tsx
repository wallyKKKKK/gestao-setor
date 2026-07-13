'use client';

import { useMemo, useRef, useState } from 'react';
import { Bot, ClipboardList, Download, Loader2, PackageSearch, Send, Sparkles, Upload, UserRound } from 'lucide-react';
import { getAuthHeaders } from '@/lib/auth-headers';

type AssistantMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ProductMatch = {
  ean: string;
  description: string;
  brand: string;
  purchasePrice: number;
  salePrice: number;
  marginPercent: number | null;
  stockSummary: string;
  stockSignal: {
    totalStock: number;
    monthlySales: number;
    avgStockDays: number | null;
    lowCoverageStores: number;
    excessStores: number;
    staleSaleStores: number;
    recentPurchaseStores: number;
  } | null;
  lastSaleSummary: string;
  lastPurchaseSummary: string;
  suggestedAction: string;
};

type SupplierMatch = {
  supplierName: string;
  category: string;
  region: string;
  paymentTerms: string;
  minOrderValue: number;
  contact: string;
};

type AssistantResponse = {
  answer: string;
  products: ProductMatch[];
  suppliers: SupplierMatch[];
  offers: {
    supplierName: string;
    sourceSystem: string;
    ean: string;
    supplierSku: string;
    description: string;
    manufacturer: string;
    category: string;
    deliveryType: string;
    availableStock: number;
    priceNf: number;
    listPrice: number;
    discountPercent: number;
    stValue: number;
    minimumQuantity: number;
    offerType: string;
    offerValidUntil: string | null;
    importedAt: string;
  }[];
  importedRows: {
    sourceTitle: string;
    sourceFile: string;
    sourceType: string;
    rowNumber: number;
    fields: Record<string, string | number | boolean | null>;
    preview: Array<{ label: string; value: string }>;
  }[];
  quoteOpportunities: {
    itemKey: string;
    description: string;
    bestSupplier: string;
    bestPrice: number;
    bestStock: number | null;
    savingsVsNext: number | null;
    recommendation: string;
    candidates: Array<{
      supplierName: string;
      source: string;
      ean: string;
      code: string;
      description: string;
      price: number;
      stock: number | null;
      delivery: string;
      validUntil: string | null;
    }>;
  }[];
  exportSuggestion: {
    query: string;
    label: string;
    estimatedRows: number;
  } | null;
  insights: {
    id: string;
    title: string;
    description: string;
    tone: 'green' | 'amber' | 'red' | 'blue' | 'slate';
  }[];
  plan: {
    id: string;
    label: string;
    value: string;
    detail: string;
  }[];
  nextActions: string[];
  mode: 'ai' | 'rules' | 'setup';
};

const QUICK_PROMPTS = [
  'Monte um plano de compra para fraldas',
  'Cote este item entre fornecedores',
  'Priorize produtos com risco de ruptura',
  'Qual a melhor oportunidade de compra?',
];

function money(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function toneClass(tone: AssistantResponse['insights'][number]['tone']) {
  if (tone === 'green') return 'border-emerald-100 bg-emerald-50 text-emerald-800';
  if (tone === 'amber') return 'border-amber-100 bg-amber-50 text-amber-800';
  if (tone === 'red') return 'border-red-100 bg-red-50 text-red-800';
  if (tone === 'blue') return 'border-blue-100 bg-blue-50 text-blue-800';
  return 'border-slate-100 bg-slate-50 text-slate-700';
}

export function PurchaseAssistant() {
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      role: 'assistant',
      content: 'Bom dia. Me diga o que voce quer comprar: produto, marca, EAN, fornecedor, categoria ou objetivo da compra.',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [lastResult, setLastResult] = useState<AssistantResponse | null>(null);
  const [supplierName, setSupplierName] = useState('PANPHARMA');
  const [sourceSystem, setSourceSystem] = useState('DIGITADOR DE PEDIDOS');
  const [offerValidUntil, setOfferValidUntil] = useState('');
  const [importingCatalog, setImportingCatalog] = useState(false);
  const [genericImportTitle, setGenericImportTitle] = useState('');
  const [genericImportType, setGenericImportType] = useState('ARQUIVO LIVRE');
  const [importingGeneric, setImportingGeneric] = useState(false);
  const [exportingSheet, setExportingSheet] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const catalogFileRef = useRef<HTMLInputElement>(null);
  const genericFileRef = useRef<HTMLInputElement>(null);

  const canSend = input.trim().length > 0 && !loading;
  const statusLabel = useMemo(() => {
    if (loading) return 'Consultando dados internos';
    if (lastResult?.mode === 'ai') return 'IA conectada';
    if (lastResult?.mode === 'setup') return 'IA aguardando chave';
    return 'Modo regras internas';
  }, [lastResult?.mode, loading]);

  async function sendMessage(message: string) {
    const trimmed = message.trim();
    if (!trimmed || loading) return;

    const nextMessages: AssistantMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    setErrorMessage('');

    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/purchase-assistant', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: trimmed,
          history: nextMessages.slice(-8),
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Falha ao consultar assistente.');
      }

      const result = data as AssistantResponse;
      setLastResult(result);
      setMessages((current) => [...current, { role: 'assistant', content: result.answer }]);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Nao foi possivel consultar o assistente.';
      setErrorMessage(messageText);
      setMessages((current) => [...current, { role: 'assistant', content: `Nao consegui responder agora: ${messageText}` }]);
    } finally {
      setLoading(false);
      queueMicrotask(() => inputRef.current?.focus());
    }
  }

  async function importSupplierCatalog(file: File) {
    if (!supplierName.trim()) {
      setErrorMessage('Informe o fornecedor antes de importar.');
      return;
    }

    setImportingCatalog(true);
    setImportMessage('');
    setErrorMessage('');

    try {
      const headers = await getAuthHeaders();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('supplierName', supplierName);
      formData.append('sourceSystem', sourceSystem);
      formData.append('offerValidUntil', offerValidUntil);

      const response = await fetch('/api/supplier-catalog/import', {
        method: 'POST',
        headers,
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Falha ao importar catalogo do fornecedor.');
      }

      setImportMessage(`${data.imported || 0} itens importados para ${data.supplierName || supplierName}. ${data.skipped || 0} ignorados.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Nao foi possivel importar catalogo.');
    } finally {
      setImportingCatalog(false);
      if (catalogFileRef.current) catalogFileRef.current.value = '';
    }
  }

  async function importGenericFile(file: File) {
    setImportingGeneric(true);
    setImportMessage('');
    setErrorMessage('');

    try {
      const headers = await getAuthHeaders();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', genericImportTitle || file.name);
      formData.append('sourceType', genericImportType);

      const response = await fetch('/api/purchase-assistant/import', {
        method: 'POST',
        headers,
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Falha ao importar arquivo livre.');
      }

      setImportMessage(`${data.imported || 0} linhas importadas em ${data.title || file.name}. ${data.columns || 0} colunas detectadas.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Nao foi possivel importar arquivo livre.');
    } finally {
      setImportingGeneric(false);
      if (genericFileRef.current) genericFileRef.current.value = '';
    }
  }

  async function exportAvailableItems(query: string) {
    setExportingSheet(true);
    setErrorMessage('');

    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/purchase-assistant/export', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Falha ao exportar planilha.');
      }

      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      const fileName = match?.[1] || `itens-disponiveis-${query}.xlsx`;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Nao foi possivel exportar planilha.');
    } finally {
      setExportingSheet(false);
    }
  }

  return (
    <main className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-4 pb-6 pt-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="flex min-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white">
              <Bot size={25} strokeWidth={2.8} />
            </div>
            <div>
              <h1 className="text-lg font-black uppercase italic tracking-tight text-slate-950">Assistente de Compras</h1>
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">{statusLabel}</p>
            </div>
          </div>
          <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-slate-500">
            Modulo isolado
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/70 p-3 sm:p-5">
          {messages.map((message, index) => {
            const isUser = message.role === 'user';

            return (
              <div key={`${message.role}-${index}`} className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
                {!isUser && (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white">
                    <Sparkles size={18} />
                  </span>
                )}
                <div className={`max-w-[min(760px,86%)] rounded-3xl px-4 py-3 text-sm font-bold leading-relaxed shadow-sm ${
                  isUser
                    ? 'bg-blue-600 text-white'
                    : 'border border-slate-100 bg-white text-slate-700'
                }`}>
                  {message.content.split('\n').map((line, lineIndex) => (
                    <p key={lineIndex} className={lineIndex > 0 ? 'mt-2' : ''}>{line}</p>
                  ))}
                </div>
                {isUser && (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white">
                    <UserRound size={18} />
                  </span>
                )}
              </div>
            );
          })}

          {loading && (
            <div className="flex items-center gap-3 rounded-3xl border border-slate-100 bg-white px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-400 shadow-sm">
              <Loader2 size={16} className="animate-spin text-emerald-600" />
              Pensando com dados de compras...
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 bg-white p-3 sm:p-4">
          {errorMessage && (
            <div className="mb-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-bold text-red-700">
              {errorMessage}
            </div>
          )}
          {lastResult?.mode === 'setup' && (
            <div className="mb-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-bold leading-relaxed text-amber-800">
              IA real ainda nao ativada: configure <code className="rounded bg-amber-100 px-1">OPENAI_API_KEY</code> no servidor e reinicie a aplicacao.
            </div>
          )}

          <div className="mb-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => sendMessage(prompt)}
                disabled={loading}
                className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-500 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>

          <div className="flex items-end gap-2 rounded-3xl border-2 border-slate-100 bg-slate-50 p-2 focus-within:border-emerald-500">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (canSend) void sendMessage(input);
                }
              }}
              placeholder="Digite um pedido de compra, produto, EAN, marca ou fornecedor..."
              rows={2}
              className="max-h-36 min-h-12 flex-1 resize-none bg-transparent px-3 py-3 text-sm font-bold text-slate-900 outline-none placeholder:text-slate-400"
            />
            <button
              type="button"
              onClick={() => sendMessage(input)}
              disabled={!canSend}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Enviar mensagem"
            >
              {loading ? <Loader2 size={19} className="animate-spin" /> : <Send size={19} />}
            </button>
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Upload size={18} className="text-emerald-600" />
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-900">Fonte de fornecedor</h2>
          </div>
          <div className="space-y-2">
            <input
              value={supplierName}
              onChange={(event) => setSupplierName(event.target.value)}
              placeholder="Fornecedor"
              className="h-10 w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 text-[11px] font-black uppercase outline-none focus:border-emerald-400"
            />
            <input
              value={sourceSystem}
              onChange={(event) => setSourceSystem(event.target.value)}
              placeholder="Sistema/fonte"
              className="h-10 w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 text-[11px] font-black uppercase outline-none focus:border-emerald-400"
            />
            <input
              value={offerValidUntil}
              onChange={(event) => setOfferValidUntil(event.target.value)}
              type="date"
              className="h-10 w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 text-[11px] font-black uppercase text-slate-500 outline-none focus:border-emerald-400"
            />
            <input
              ref={catalogFileRef}
              type="file"
              accept=".csv,.txt,.xls,.xlsx"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importSupplierCatalog(file);
              }}
            />
            <button
              type="button"
              onClick={() => catalogFileRef.current?.click()}
              disabled={importingCatalog}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-wide text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {importingCatalog ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {importingCatalog ? 'Importando...' : 'Importar oferta/estoque'}
            </button>
            {importMessage && (
              <p className="rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[10px] font-bold text-emerald-700">{importMessage}</p>
            )}
            <p className="text-[10px] font-bold leading-relaxed text-slate-400">
              Aceita CSV, TXT, XLS e XLSX com colunas como EAN, codigo, descricao, estoque, preco NF, entrega, categoria e laboratorio.
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Upload size={18} className="text-blue-600" />
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-900">Arquivo livre</h2>
          </div>
          <div className="space-y-2">
            <input
              value={genericImportTitle}
              onChange={(event) => setGenericImportTitle(event.target.value)}
              placeholder="Nome para essa base"
              className="h-10 w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 text-[11px] font-black uppercase outline-none focus:border-blue-400"
            />
            <input
              value={genericImportType}
              onChange={(event) => setGenericImportType(event.target.value)}
              placeholder="Tipo/fonte"
              className="h-10 w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 text-[11px] font-black uppercase outline-none focus:border-blue-400"
            />
            <input
              ref={genericFileRef}
              type="file"
              accept=".csv,.txt,.xls,.xlsx,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importGenericFile(file);
              }}
            />
            <button
              type="button"
              onClick={() => genericFileRef.current?.click()}
              disabled={importingGeneric}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 text-[10px] font-black uppercase tracking-wide text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {importingGeneric ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {importingGeneric ? 'Importando...' : 'Importar arquivo livre'}
            </button>
            <p className="text-[10px] font-bold leading-relaxed text-slate-400">
              Use para qualquer tabela: preco, estoque, EAN, codigo, pedido, campanha, relatorio ou lista com colunas fora do padrao.
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <ClipboardList size={18} className="text-emerald-600" />
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-900">Plano de compra</h2>
          </div>
          <div className="space-y-2">
            {lastResult?.exportSuggestion && (
              <button
                type="button"
                onClick={() => void exportAvailableItems(lastResult.exportSuggestion?.query || '')}
                disabled={exportingSheet}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-3 py-3 text-[10px] font-black uppercase tracking-wide text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {exportingSheet ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                {exportingSheet ? 'Exportando...' : `Baixar planilha (${lastResult.exportSuggestion.estimatedRows})`}
              </button>
            )}
            {(lastResult?.plan || []).map((item) => (
              <div key={item.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{item.label}</p>
                <p className="mt-1 line-clamp-2 text-[12px] font-black uppercase text-slate-900">{item.value}</p>
                <p className="mt-2 text-[10px] font-bold leading-relaxed text-slate-500">{item.detail}</p>
              </div>
            ))}
            {(lastResult?.insights || []).map((insight) => (
              <div key={insight.id} className={`rounded-2xl border px-3 py-2 ${toneClass(insight.tone)}`}>
                <p className="text-[10px] font-black uppercase tracking-wide">{insight.title}</p>
                <p className="mt-1 text-[10px] font-bold leading-relaxed opacity-80">{insight.description}</p>
              </div>
            ))}
            {!lastResult && (
              <p className="rounded-2xl border-2 border-dashed border-slate-100 p-5 text-center text-[10px] font-black uppercase tracking-widest text-slate-300">
                Pergunte algo para montar o plano
              </p>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-xs font-black uppercase tracking-widest text-slate-900">Dados livres encontrados</h2>
          <div className="space-y-2">
            {(lastResult?.importedRows || []).slice(0, 4).map((row) => (
              <div key={`${row.sourceTitle}-${row.rowNumber}`} className="rounded-2xl border border-blue-100 bg-blue-50 p-3">
                <p className="text-[10px] font-black uppercase text-blue-800">{row.sourceTitle} | linha {row.rowNumber}</p>
                <div className="mt-2 space-y-1">
                  {row.preview.slice(0, 5).map((item) => (
                    <p key={`${row.rowNumber}-${item.label}`} className="text-[10px] font-bold text-slate-600">
                      <b className="text-slate-900">{item.label}:</b> {item.value}
                    </p>
                  ))}
                </div>
              </div>
            ))}
            {(!lastResult || lastResult.importedRows.length === 0) && (
              <p className="rounded-2xl border-2 border-dashed border-slate-100 p-5 text-center text-[10px] font-black uppercase tracking-widest text-slate-300">
                Sem linha livre na consulta
              </p>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-xs font-black uppercase tracking-widest text-slate-900">Cotacao e oportunidade</h2>
          <div className="space-y-2">
            {(lastResult?.quoteOpportunities || []).slice(0, 3).map((quote) => (
              <div key={quote.itemKey} className="rounded-2xl border border-amber-100 bg-amber-50 p-3">
                <p className="line-clamp-2 text-[12px] font-black uppercase text-amber-900">{quote.description}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-black uppercase">
                  <span className="rounded-xl bg-white p-2 text-slate-500">Melhor<br /><b className="text-slate-900">{quote.bestSupplier}</b></span>
                  <span className="rounded-xl bg-white p-2 text-slate-500">Preco<br /><b className="text-slate-900">{money(quote.bestPrice)}</b></span>
                </div>
                <p className="mt-2 text-[10px] font-bold leading-relaxed text-amber-800">{quote.recommendation}</p>
                <div className="mt-2 space-y-1">
                  {quote.candidates.slice(0, 4).map((candidate) => (
                    <div key={`${quote.itemKey}-${candidate.supplierName}-${candidate.price}-${candidate.source}`} className="flex items-center justify-between gap-2 rounded-xl bg-white px-2 py-1 text-[10px] font-bold text-slate-600">
                      <span className="min-w-0 truncate">{candidate.supplierName}</span>
                      <span className="shrink-0 font-black text-slate-900">{money(candidate.price)}</span>
                      <span className="shrink-0 text-slate-400">{candidate.stock === null ? 'S/E' : `Est. ${candidate.stock}`}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {(!lastResult || lastResult.quoteOpportunities.length === 0) && (
              <p className="rounded-2xl border-2 border-dashed border-slate-100 p-5 text-center text-[10px] font-black uppercase tracking-widest text-slate-300">
                Sem cotacao comparavel
              </p>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-xs font-black uppercase tracking-widest text-slate-900">Ofertas importadas</h2>
          <div className="space-y-2">
            {(lastResult?.offers || []).slice(0, 4).map((offer) => (
              <div key={`${offer.supplierName}-${offer.supplierSku}-${offer.ean}-${offer.description}`} className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
                <p className="line-clamp-2 text-[12px] font-black uppercase text-emerald-900">{offer.description}</p>
                <p className="mt-1 text-[10px] font-bold uppercase text-emerald-700">{offer.supplierName} | {offer.manufacturer || 'Sem lab.'}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-black uppercase">
                  <span className="rounded-xl bg-white p-2 text-slate-500">Preco NF<br /><b className="text-slate-900">{money(offer.priceNf || offer.listPrice)}</b></span>
                  <span className="rounded-xl bg-white p-2 text-slate-500">Estoque<br /><b className="text-slate-900">{offer.availableStock.toLocaleString('pt-BR')}</b></span>
                </div>
                <p className="mt-2 text-[10px] font-bold text-slate-500">{offer.deliveryType || 'Entrega nao informada'} {offer.offerValidUntil ? `| Validade ${offer.offerValidUntil}` : ''}</p>
              </div>
            ))}
            {(!lastResult || lastResult.offers.length === 0) && (
              <p className="rounded-2xl border-2 border-dashed border-slate-100 p-5 text-center text-[10px] font-black uppercase tracking-widest text-slate-300">
                Sem oferta na consulta
              </p>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <PackageSearch size={18} className="text-emerald-600" />
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-900">Produtos encontrados</h2>
          </div>
          <div className="space-y-2">
            {(lastResult?.products || []).slice(0, 5).map((product) => (
              <div key={`${product.ean}-${product.description}`} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                <p className="line-clamp-2 text-[12px] font-black uppercase text-slate-900">{product.description}</p>
                <p className="mt-1 text-[10px] font-bold uppercase text-slate-400">{product.brand || 'Sem fabricante'} | {product.ean || 'Sem EAN'}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-black uppercase">
                  <span className="rounded-xl bg-white p-2 text-slate-500">Compra<br /><b className="text-slate-900">{money(product.purchasePrice)}</b></span>
                  <span className="rounded-xl bg-white p-2 text-slate-500">Venda<br /><b className="text-slate-900">{money(product.salePrice)}</b></span>
                </div>
                <p className="mt-2 text-[10px] font-bold text-slate-500">{product.stockSummary}</p>
                {product.stockSignal && (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] font-black uppercase">
                    <span className="rounded-xl bg-white p-2 text-slate-500">Cobertura<br /><b className="text-slate-900">{product.stockSignal.avgStockDays === null ? 'S/H' : `${Math.round(product.stockSignal.avgStockDays)} dias`}</b></span>
                    <span className="rounded-xl bg-white p-2 text-slate-500">Venda/mes<br /><b className="text-slate-900">{product.stockSignal.monthlySales.toFixed(1).replace('.', ',')}</b></span>
                  </div>
                )}
                <p className="mt-2 text-[10px] font-bold text-slate-500">{product.lastSaleSummary}</p>
                <p className="mt-1 text-[10px] font-bold text-slate-500">{product.lastPurchaseSummary}</p>
                <p className="mt-2 rounded-xl bg-white p-2 text-[10px] font-black uppercase leading-relaxed text-emerald-700">{product.suggestedAction}</p>
              </div>
            ))}
            {(!lastResult || lastResult.products.length === 0) && (
              <p className="rounded-2xl border-2 border-dashed border-slate-100 p-5 text-center text-[10px] font-black uppercase tracking-widest text-slate-300">
                Sem consulta ainda
              </p>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-xs font-black uppercase tracking-widest text-slate-900">Fornecedores e proximos passos</h2>
          <div className="space-y-2">
            {(lastResult?.suppliers || []).slice(0, 3).map((supplier) => (
              <div key={supplier.supplierName} className="rounded-2xl bg-emerald-50 p-3">
                <p className="text-[12px] font-black uppercase text-emerald-800">{supplier.supplierName}</p>
                <p className="mt-1 text-[10px] font-bold text-slate-500">{supplier.category} | {supplier.region}</p>
                <p className="mt-2 text-[11px] font-black text-slate-700">Prazo: {supplier.paymentTerms}</p>
                <p className="mt-1 text-[10px] font-bold text-slate-500">{supplier.contact}</p>
              </div>
            ))}
            {(lastResult?.nextActions || []).map((action) => (
              <div key={action} className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600">
                {action}
              </div>
            ))}
            {!lastResult && (
              <p className="text-[11px] font-bold leading-relaxed text-slate-400">
                As respostas aparecem aqui com produtos, fornecedores e acoes sugeridas conforme a conversa.
              </p>
            )}
          </div>
        </section>
      </aside>
    </main>
  );
}
