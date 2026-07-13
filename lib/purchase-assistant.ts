import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { parseLocaleNumber } from "@/lib/number";
import type { PricingProduct, PurchaseAssistantImportRow, ReallocationProduct, ReallocationStockItem, SupplierCatalogItem, SupplierPaymentTerm } from "@/lib/types";

const PRICING_PRODUCT_SELECT = "id,ean,description,brand,purchase_price,sell_in_value,sell_in_mode,sell_out_value,sell_out_mode,trade_value,trade_mode,sale_price,baby_wednesday_price,month_end_price,competitor_prices,store_prices,is_active,created_at,updated_at";
const REALLOCATION_PRODUCT_SELECT = "id,erp_code,ean,description,manufacturer,classification,search_text,source_file,imported_at,created_at,updated_at";
const REALLOCATION_STOCK_ITEM_SELECT = "id,snapshot_id,store_code,store_name,ean,erp_code,product_description,stock,confirmed_stock,monthly_avg_sales,stock_days,curve,confirmed_purchase,confirmed_transfer,last_sale_days,last_purchase_days,last_purchase_supplier,need_type,rupture_sales,supplied_percent,min_stock,max_stock,need_cost,created_at";
const SUPPLIER_CATALOG_ITEM_SELECT = "id,supplier_name,source_system,source_file,row_key,ean,supplier_sku,description,manufacturer,category,delivery_type,available_stock,price_nf,list_price,discount_percent,st_value,minimum_quantity,offer_type,offer_valid_until,is_active,imported_by,imported_at,created_at,updated_at";
const SUPPLIER_PAYMENT_TERM_SELECT = "id,supplier_name,payment_terms,category,region,min_order_value,condition_notes,contact_name,phone,email,tax_id,is_active,sort_order,created_at,updated_at";

export interface PurchaseAssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PurchaseAssistantRequest {
  message: string;
  history?: PurchaseAssistantMessage[];
}

export interface PurchaseAssistantProductMatch {
  ean: string;
  description: string;
  brand: string;
  purchasePrice: number;
  salePrice: number;
  marginPercent: number | null;
  stockSummary: string;
  stockSignal: PurchaseAssistantStockSignal | null;
  lastSaleSummary: string;
  lastPurchaseSummary: string;
  suggestedAction: string;
  suggestedPurchaseQty: number | null;
  coverageTargetDays: number;
}

export interface PurchaseAssistantSupplierMatch {
  supplierName: string;
  category: string;
  region: string;
  paymentTerms: string;
  minOrderValue: number;
  contact: string;
}

export interface PurchaseAssistantSupplierOffer {
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
}

export interface PurchaseAssistantImportedDataMatch {
  sourceTitle: string;
  sourceFile: string;
  sourceType: string;
  rowNumber: number;
  fields: Record<string, string | number | boolean | null>;
  preview: Array<{ label: string; value: string }>;
}

export interface PurchaseAssistantQuoteCandidate {
  supplierName: string;
  source: string;
  ean: string;
  code: string;
  description: string;
  price: number;
  listPrice: number;
  discountPercent: number;
  stValue: number;
  minimumQuantity: number;
  effectiveCost: number;
  stock: number | null;
  delivery: string;
  validUntil: string | null;
}

export interface PurchaseAssistantQuoteOpportunity {
  itemKey: string;
  description: string;
  bestSupplier: string;
  bestPrice: number;
  bestEffectiveCost: number;
  bestStock: number | null;
  savingsVsNext: number | null;
  resultingMarginPercent: number | null;
  recommendation: string;
  candidates: PurchaseAssistantQuoteCandidate[];
}

export interface PurchaseAssistantExportSuggestion {
  query: string;
  label: string;
  estimatedRows: number;
}

export type PurchaseAssistantTone = "green" | "amber" | "red" | "blue" | "slate";

export interface PurchaseAssistantInsight {
  id: string;
  title: string;
  description: string;
  tone: PurchaseAssistantTone;
}

export interface PurchaseAssistantPlanItem {
  id: string;
  label: string;
  value: string;
  detail: string;
}

export interface PurchaseAssistantStockSignal {
  totalStock: number;
  monthlySales: number;
  avgStockDays: number | null;
  lowCoverageStores: number;
  excessStores: number;
  staleSaleStores: number;
  recentPurchaseStores: number;
}

export interface PurchaseAssistantResponse {
  answer: string;
  products: PurchaseAssistantProductMatch[];
  suppliers: PurchaseAssistantSupplierMatch[];
  offers: PurchaseAssistantSupplierOffer[];
  importedRows: PurchaseAssistantImportedDataMatch[];
  quoteOpportunities: PurchaseAssistantQuoteOpportunity[];
  exportSuggestion: PurchaseAssistantExportSuggestion | null;
  insights: PurchaseAssistantInsight[];
  plan: PurchaseAssistantPlanItem[];
  nextActions: string[];
  mode: "ai" | "rules" | "setup";
}

const STOP_WORDS = new Set([
  "a",
  "as",
  "ao",
  "aos",
  "com",
  "comprar",
  "compra",
  "compras",
  "cotar",
  "cotacao",
  "cotacoes",
  "cote",
  "de",
  "descricao",
  "disponivel",
  "disponiveis",
  "do",
  "dos",
  "da",
  "das",
  "e",
  "em",
  "eu",
  "essa",
  "esse",
  "este",
  "estoque",
  "estoques",
  "item",
  "itens",
  "excel",
  "exporta",
  "exportar",
  "me",
  "o",
  "os",
  "para",
  "preco",
  "precos",
  "planilha",
  "por",
  "preciso",
  "qual",
  "quais",
  "quero",
  "melhor",
  "mais",
  "oportunidade",
  "quantidade",
  "saldo",
  "um",
  "uma",
]);

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function keywordsFromMessage(message: string) {
  return Array.from(new Set(
    normalize(message)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
  )).slice(0, 8);
}

function isExportRequest(message: string) {
  const normalized = normalize(message);
  return /\b(export|exportar|planilha|excel|xlsx|csv)\b/.test(normalized);
}

function exportQueryFromMessage(message: string, keywords: string[]) {
  if (!isExportRequest(message)) return "";
  return keywords[0] || normalize(message).split(/\s+/).find((word) => word.length >= 3 && !STOP_WORDS.has(word)) || "";
}

function isOpenAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Dias de cobertura-alvo usados para sugerir quantidade de compra (padrao: 30 dias / 1 mes).
const COVERAGE_TARGET_DAYS = Number(process.env.PURCHASE_ASSISTANT_COVERAGE_DAYS) || 30;

// Custo unitario efetivo de uma cotacao: preco NF menos desconto (%) mais ST (valor por unidade).
function effectiveUnitCost(input: { price: number; discountPercent?: number; stValue?: number }) {
  const base = input.price > 0 ? input.price : 0;
  const discounted = base * (1 - (input.discountPercent || 0) / 100);
  return Number((Math.max(discounted, 0) + (input.stValue || 0)).toFixed(4));
}

// Quantidade sugerida de compra: cobre COVERAGE_TARGET_DAYS de venda media, descontando o estoque atual.
function suggestedPurchaseQtyFor(signal: PurchaseAssistantStockSignal | null) {
  if (!signal || signal.monthlySales <= 0) return null;
  const target = signal.monthlySales * (COVERAGE_TARGET_DAYS / 30);
  return Math.max(0, Math.ceil(target - signal.totalStock));
}

function marginPercent(product: Pick<PricingProduct, "purchase_price" | "sale_price">) {
  if (!product.purchase_price || !product.sale_price) return null;
  return ((product.sale_price - product.purchase_price) / product.purchase_price) * 100;
}

function numberValue(value: number | null | undefined) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseLooseNumber(value: string | number | boolean | null | undefined) {
  return parseLocaleNumber(value);
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatDays(value: number | null) {
  if (value === null) return "sem historico";
  const rounded = Math.round(value);
  if (rounded <= 0) return "hoje/sem atraso";
  return `${rounded} dia${rounded === 1 ? "" : "s"}`;
}

function stockSignalFor(productStock: ReallocationStockItem[]): PurchaseAssistantStockSignal | null {
  if (!productStock.length) return null;

  const totalStock = productStock.reduce((sum, item) => sum + numberValue(item.confirmed_stock || item.stock), 0);
  const monthlySales = productStock.reduce((sum, item) => sum + numberValue(item.monthly_avg_sales), 0);
  const stockDaysValues = productStock
    .map((item) => numberValue(item.stock_days))
    .filter((value) => value > 0 && value < 9999);

  return {
    totalStock,
    monthlySales: Number(monthlySales.toFixed(2)),
    avgStockDays: stockDaysValues.length ? Number((average(stockDaysValues) || 0).toFixed(1)) : null,
    lowCoverageStores: productStock.filter((item) => (
      numberValue(item.monthly_avg_sales) > 0
      && numberValue(item.stock_days) > 0
      && numberValue(item.stock_days) <= 15
    )).length,
    excessStores: productStock.filter((item) => (
      numberValue(item.stock_days) >= 90
      || (numberValue(item.confirmed_stock || item.stock) > 0 && numberValue(item.monthly_avg_sales) <= 0)
    )).length,
    staleSaleStores: productStock.filter((item) => numberValue(item.last_sale_days) >= 90).length,
    recentPurchaseStores: productStock.filter((item) => {
      const days = numberValue(item.last_purchase_days);
      return days > 0 && days <= 30;
    }).length,
  };
}

function summarizeLastSale(productStock: ReallocationStockItem[]) {
  const values = productStock.map((item) => numberValue(item.last_sale_days)).filter((value) => value > 0);
  if (!values.length) return "Ultima venda sem historico no snapshot";
  return `Ultima venda entre ${formatDays(Math.min(...values))} e ${formatDays(Math.max(...values))}`;
}

function summarizeLastPurchase(productStock: ReallocationStockItem[]) {
  const values = productStock.map((item) => numberValue(item.last_purchase_days)).filter((value) => value > 0);
  if (!values.length) return "Ultima compra sem historico no snapshot";
  return `Ultima compra entre ${formatDays(Math.min(...values))} e ${formatDays(Math.max(...values))}`;
}

function suggestedActionFor(signal: PurchaseAssistantStockSignal | null, margin: number | null) {
  if (!signal) return "Validar estoque atual antes de decidir compra.";
  if (signal.lowCoverageStores > 0 && signal.excessStores > 0) {
    return "Priorizar remanejamento e comprar apenas a diferenca que continuar descoberta.";
  }
  if (signal.lowCoverageStores > 0) {
    return "Priorizar compra: ha lojas com cobertura baixa.";
  }
  if (signal.excessStores > 0 && signal.lowCoverageStores === 0) {
    return "Evitar compra grande: ha sinais de excesso ou giro parado.";
  }
  if (signal.recentPurchaseStores > 0) {
    return "Conferir pedidos recentes antes de recomprar.";
  }
  if (margin !== null && margin < 20) {
    return "Negociar preco: margem estimada baixa.";
  }
  return "Produto sem alerta forte; validar preco e prazo com fornecedor.";
}

function productToMatch(product: PricingProduct, stockItems: ReallocationStockItem[]): PurchaseAssistantProductMatch {
  const descriptionKey = normalize(product.description || "").slice(0, 24);
  const productStock = stockItems.filter((item) => (
    (product.ean && item.ean === product.ean)
    || (descriptionKey.length >= 4 && normalize(item.product_description).includes(descriptionKey))
  ));
  const totalStock = productStock.reduce((sum, item) => sum + Number(item.confirmed_stock || item.stock || 0), 0);
  const stores = Array.from(new Set(productStock.map((item) => item.store_name || item.store_code).filter(Boolean))).slice(0, 3);
  const margin = marginPercent(product);
  const stockSignal = stockSignalFor(productStock);

  return {
    ean: product.ean,
    description: product.description,
    brand: product.brand,
    purchasePrice: product.purchase_price || 0,
    salePrice: product.sale_price || 0,
    marginPercent: margin === null ? null : Number(margin.toFixed(2)),
    stockSummary: productStock.length
      ? `${totalStock} un. em ${productStock.length} loja(s)${stores.length ? `: ${stores.join(", ")}` : ""}`
      : "Sem snapshot de estoque encontrado",
    stockSignal,
    lastSaleSummary: summarizeLastSale(productStock),
    lastPurchaseSummary: summarizeLastPurchase(productStock),
    suggestedAction: suggestedActionFor(stockSignal, margin),
    suggestedPurchaseQty: suggestedPurchaseQtyFor(stockSignal),
    coverageTargetDays: COVERAGE_TARGET_DAYS,
  };
}

function supplierToMatch(supplier: SupplierPaymentTerm): PurchaseAssistantSupplierMatch {
  return {
    supplierName: supplier.supplier_name,
    category: supplier.category,
    region: supplier.region,
    paymentTerms: supplier.payment_terms,
    minOrderValue: supplier.min_order_value || 0,
    contact: [supplier.contact_name, supplier.phone, supplier.email].filter(Boolean).join(" | ") || "Contato nao cadastrado",
  };
}

function offerToMatch(offer: SupplierCatalogItem): PurchaseAssistantSupplierOffer {
  return {
    supplierName: offer.supplier_name,
    sourceSystem: offer.source_system,
    ean: offer.ean,
    supplierSku: offer.supplier_sku,
    description: offer.description,
    manufacturer: offer.manufacturer,
    category: offer.category,
    deliveryType: offer.delivery_type,
    availableStock: numberValue(offer.available_stock),
    priceNf: numberValue(offer.price_nf),
    listPrice: numberValue(offer.list_price),
    discountPercent: numberValue(offer.discount_percent),
    stValue: numberValue(offer.st_value),
    minimumQuantity: numberValue(offer.minimum_quantity),
    offerType: offer.offer_type,
    offerValidUntil: offer.offer_valid_until,
    importedAt: offer.imported_at,
  };
}

function dedupeOffers(offers: SupplierCatalogItem[]) {
  const seen = new Set<string>();
  return offers.filter((offer) => {
    const key = `${offer.supplier_name}|${offer.row_key}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeOfferMatches(offers: PurchaseAssistantSupplierOffer[]) {
  const seen = new Set<string>();
  return offers.filter((offer) => {
    const key = `${offer.supplierName}|${offer.supplierSku || offer.ean}|${offer.description}|${offer.priceNf || offer.listPrice}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function importedRowToMatch(row: PurchaseAssistantImportRow): PurchaseAssistantImportedDataMatch {
  const rowData = row.row_data || {};
  const preview = Object.entries(rowData)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
    .slice(0, 8)
    .map(([label, value]) => ({ label, value: String(value) }));
  const source = row.purchase_assistant_imports;

  return {
    sourceTitle: source?.title || "Importacao do assistente",
    sourceFile: source?.source_file || "",
    sourceType: source?.source_type || "",
    rowNumber: row.row_number,
    fields: row.detected_fields || {},
    preview,
  };
}

function quoteItemKey(input: { ean?: string; code?: string; description: string }) {
  if (input.ean) return `ean:${input.ean}`;
  if (input.code) return `code:${input.code}`;
  return `desc:${normalize(input.description).replace(/[^a-z0-9]+/g, " ").split(" ").slice(0, 6).join(" ")}`;
}

function quoteCandidatesFromOffers(offers: PurchaseAssistantSupplierOffer[]): PurchaseAssistantQuoteCandidate[] {
  return offers
    .map((offer) => {
      const price = numberValue(offer.priceNf || offer.listPrice);
      const discountPercent = numberValue(offer.discountPercent);
      const stValue = numberValue(offer.stValue);
      return {
        supplierName: offer.supplierName || "Fornecedor nao informado",
        source: offer.sourceSystem || "Catalogo fornecedor",
        ean: offer.ean,
        code: offer.supplierSku,
        description: offer.description,
        price,
        listPrice: numberValue(offer.listPrice),
        discountPercent,
        stValue,
        minimumQuantity: numberValue(offer.minimumQuantity),
        effectiveCost: effectiveUnitCost({ price, discountPercent, stValue }),
        stock: offer.availableStock ?? null,
        delivery: offer.deliveryType,
        validUntil: offer.offerValidUntil,
      };
    })
    .filter((candidate) => candidate.description && candidate.price > 0);
}

function quoteCandidatesFromImportedRows(rows: PurchaseAssistantImportedDataMatch[]): PurchaseAssistantQuoteCandidate[] {
  return rows
    .map((row) => {
      const fields = row.fields || {};
      const previewMap = new Map(row.preview.map((item) => [normalize(item.label), item.value]));
      const fieldValue = (key: string) => fields[key] ?? previewMap.get(key) ?? "";
      const description = String(fieldValue("description") || row.preview.find((item) => normalize(item.label).includes("descr"))?.value || row.preview[0]?.value || "");
      const price = parseLooseNumber(fieldValue("price"));
      const discountPercent = parseLooseNumber(fieldValue("discount"));
      const stValue = parseLooseNumber(fieldValue("st"));

      return {
        supplierName: String(fieldValue("supplier") || row.sourceTitle || "Fornecedor nao informado"),
        source: row.sourceType || row.sourceFile || "Arquivo livre",
        ean: String(fieldValue("ean") || ""),
        code: String(fieldValue("code") || ""),
        description,
        price,
        listPrice: price,
        discountPercent,
        stValue,
        minimumQuantity: parseLooseNumber(fieldValue("min")),
        effectiveCost: effectiveUnitCost({ price, discountPercent, stValue }),
        stock: fieldValue("stock") === "" ? null : parseLooseNumber(fieldValue("stock")),
        delivery: "",
        validUntil: null,
      };
    })
    .filter((candidate) => candidate.description && candidate.price > 0);
}

function buildQuoteOpportunities(
  offers: PurchaseAssistantSupplierOffer[],
  importedRows: PurchaseAssistantImportedDataMatch[],
  salePriceByEan: Map<string, number>,
): PurchaseAssistantQuoteOpportunity[] {
  const candidates = [
    ...quoteCandidatesFromOffers(offers),
    ...quoteCandidatesFromImportedRows(importedRows),
  ];
  const groups = new Map<string, PurchaseAssistantQuoteCandidate[]>();

  candidates.forEach((candidate) => {
    const key = quoteItemKey(candidate);
    groups.set(key, [...(groups.get(key) || []), candidate]);
  });

  return Array.from(groups.entries())
    .map(([itemKey, group]) => {
      const uniqueBySupplier = Array.from(
        group.reduce((map, candidate) => {
          const key = `${candidate.supplierName}|${candidate.price}|${candidate.source}`;
          if (!map.has(key)) map.set(key, candidate);
          return map;
        }, new Map<string, PurchaseAssistantQuoteCandidate>()).values(),
      );
      const sorted = uniqueBySupplier.sort((left, right) => {
        const leftHasStock = left.stock === null || left.stock > 0 ? 0 : 1;
        const rightHasStock = right.stock === null || right.stock > 0 ? 0 : 1;
        return leftHasStock - rightHasStock || left.effectiveCost - right.effectiveCost;
      });
      const best = sorted[0];
      const next = sorted.find((candidate) => candidate.supplierName !== best?.supplierName && candidate.effectiveCost >= (best?.effectiveCost || 0));

      if (!best) return null;

      const salePrice = best.ean ? salePriceByEan.get(best.ean) || 0 : 0;
      const resultingMarginPercent = salePrice > 0 && best.effectiveCost > 0
        ? Number((((salePrice - best.effectiveCost) / best.effectiveCost) * 100).toFixed(1))
        : null;
      const marginSuffix = resultingMarginPercent === null
        ? ""
        : ` Margem estimada de ${resultingMarginPercent.toFixed(1).replace(".", ",")}% no preco de venda atual.`;

      return {
        itemKey,
        description: best.description,
        bestSupplier: best.supplierName,
        bestPrice: best.price,
        bestEffectiveCost: best.effectiveCost,
        bestStock: best.stock,
        savingsVsNext: next ? Number((next.effectiveCost - best.effectiveCost).toFixed(2)) : null,
        resultingMarginPercent,
        recommendation: best.stock === 0
          ? `Menor custo efetivo (${money(best.effectiveCost)}/un.), mas estoque informado esta zerado. Confirmar disponibilidade antes de fechar.${marginSuffix}`
          : next
            ? `Melhor custo efetivo entre ${sorted.length} cotacao(oes): ${money(best.effectiveCost)}/un. Economia de ${money(next.effectiveCost - best.effectiveCost)} por unidade contra a proxima opcao.${marginSuffix}`
            : `Unica cotacao encontrada (${money(best.effectiveCost)}/un.). Validar com mais fornecedores antes de fechar volume grande.${marginSuffix}`,
        candidates: sorted.slice(0, 5),
      };
    })
    .filter((item): item is PurchaseAssistantQuoteOpportunity => Boolean(item))
    .filter((item) => item.candidates.length >= 1)
    .sort((left, right) => (right.savingsVsNext || 0) - (left.savingsVsNext || 0))
    .slice(0, 4);
}

async function safeSelect<T>(run: () => Promise<{ data: T[] | null; error: { code?: string; message?: string } | null }>) {
  const { data, error } = await run();
  if (!error) return data || [];
  if (error.code === "42P01" || error.code === "PGRST205") return [];
  throw new Error(error.message || "Falha ao consultar dados de compras.");
}

export async function fetchPurchaseAssistantExportRows(query: string) {
  const search = query.trim();
  if (!search) return [];

  const supabase = getSupabaseAdmin();
  const safeSearch = search.replace(/[%_]/g, "");
  const rows = await safeSelect<SupplierCatalogItem>(async () => await supabase
    .from("supplier_catalog_items")
    .select(SUPPLIER_CATALOG_ITEM_SELECT)
    .eq("is_active", true)
    .gt("available_stock", 0)
    .or(`supplier_name.ilike.%${safeSearch}%,ean.ilike.%${safeSearch}%,supplier_sku.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%,manufacturer.ilike.%${safeSearch}%,category.ilike.%${safeSearch}%`)
    .order("description", { ascending: true })
    .limit(2000));

  return rows.map((row) => ({
    EAN: row.ean,
    SKU: row.supplier_sku,
    Descricao: row.description,
    Fornecedor: row.supplier_name,
    Fonte: row.source_system,
    Laboratorio: row.manufacturer,
    Categoria: row.category,
    Estoque: numberValue(row.available_stock),
    Preco: numberValue(row.price_nf || row.list_price),
    "Preco tabela": numberValue(row.list_price),
    "Desconto %": numberValue(row.discount_percent),
    Entrega: row.delivery_type,
    "Qtd minima": numberValue(row.minimum_quantity),
    Validade: row.offer_valid_until || "",
    Atualizado: row.imported_at,
  }));
}

async function loadContext(message: string) {
  const supabase = getSupabaseAdmin();
  const keywords = keywordsFromMessage(message);
  const search = keywords[0] || message.trim().slice(0, 40);
  const safeSearch = search.replace(/[%_]/g, "");

  const pricingProducts = await safeSelect<PricingProduct>(async () => await supabase
    .from("pricing_products")
    .select(PRICING_PRODUCT_SELECT)
    .or(`ean.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%,brand.ilike.%${safeSearch}%`)
    .order("description", { ascending: true })
    .limit(8));

  const masterProducts = await safeSelect<ReallocationProduct>(async () => await supabase
    .from("reallocation_products")
    .select(REALLOCATION_PRODUCT_SELECT)
    .or(`erp_code.ilike.%${safeSearch}%,ean.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%,manufacturer.ilike.%${safeSearch}%,classification.ilike.%${safeSearch}%`)
    .order("description", { ascending: true })
    .limit(12));

  const masterByEan = new Map(masterProducts.filter((product) => product.ean).map((product) => [product.ean, product]));
  const pricedEans = new Set(pricingProducts.map((product) => product.ean).filter(Boolean));
  const products: PricingProduct[] = [
    ...pricingProducts.map((product) => {
      const master = masterByEan.get(product.ean);
      return master
        ? {
          ...product,
          ean: master.ean || product.ean,
          description: master.description || product.description,
          brand: master.manufacturer || product.brand,
        }
        : product;
    }),
    ...masterProducts
      .filter((product) => product.ean && !pricedEans.has(product.ean))
      .map((product) => ({
        id: `master:${product.id}`,
        ean: product.ean,
        description: product.description,
        brand: product.manufacturer,
        purchase_price: 0,
        sell_in_value: 0,
        sell_in_mode: "currency" as const,
        sell_out_value: 0,
        sell_out_mode: "currency" as const,
        trade_value: 0,
        trade_mode: "percent" as const,
        sale_price: 0,
        baby_wednesday_price: 0,
        month_end_price: 0,
        competitor_prices: {},
        store_prices: {},
        is_active: true,
      })),
  ].slice(0, 12);

  const suppliers = await safeSelect<SupplierPaymentTerm>(async () => await supabase
    .from("supplier_payment_terms")
    .select(SUPPLIER_PAYMENT_TERM_SELECT)
    .or(`supplier_name.ilike.%${safeSearch}%,category.ilike.%${safeSearch}%,condition_notes.ilike.%${safeSearch}%`)
    .eq("is_active", true)
    .order("supplier_name", { ascending: true })
    .limit(6));

  const { data: snapshot, error: snapshotError } = await supabase
    .from("reallocation_stock_snapshots")
    .select("id")
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const productEans = products.map((product) => product.ean).filter(Boolean);
  const stockItems = !snapshotError && snapshot?.id && productEans.length
    ? await safeSelect<ReallocationStockItem>(async () => await supabase
      .from("reallocation_stock_items")
      .select(REALLOCATION_STOCK_ITEM_SELECT)
      .eq("snapshot_id", snapshot.id)
      .in("ean", productEans)
      .limit(80))
    : [];

  const offerSearchRows = await safeSelect<SupplierCatalogItem>(async () => await supabase
    .from("supplier_catalog_items")
    .select(SUPPLIER_CATALOG_ITEM_SELECT)
    .eq("is_active", true)
    .or(`supplier_name.ilike.%${safeSearch}%,ean.ilike.%${safeSearch}%,supplier_sku.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%,manufacturer.ilike.%${safeSearch}%,category.ilike.%${safeSearch}%`)
    .order("imported_at", { ascending: false })
    .limit(12));

  const offerEanRows = productEans.length
    ? await safeSelect<SupplierCatalogItem>(async () => await supabase
      .from("supplier_catalog_items")
      .select(SUPPLIER_CATALOG_ITEM_SELECT)
      .eq("is_active", true)
      .in("ean", productEans)
      .order("price_nf", { ascending: true })
      .limit(16))
    : [];

  const offers = dedupeOffers([...offerEanRows, ...offerSearchRows]).slice(0, 16);
  const importedRows = await safeSelect<PurchaseAssistantImportRow>(async () => await supabase
    .from("purchase_assistant_import_rows")
    .select("*, purchase_assistant_imports(title, source_file, source_type, imported_at)")
    .ilike("normalized_text", `%${safeSearch}%`)
    .order("imported_at", { ascending: false })
    .limit(12));

  const matchedImportedRows = importedRows.map(importedRowToMatch);
  const matchedOffers = dedupeOfferMatches(offers.map(offerToMatch)).slice(0, 24);
  const exportQuery = exportQueryFromMessage(message, keywords);
  const exportRows = exportQuery ? await fetchPurchaseAssistantExportRows(exportQuery) : [];

  return {
    keywords,
    products: products.map((product) => productToMatch(product, stockItems)),
    suppliers: suppliers.map(supplierToMatch),
    offers: matchedOffers,
    importedRows: matchedImportedRows,
    quoteOpportunities: buildQuoteOpportunities(matchedOffers, matchedImportedRows),
    exportSuggestion: exportQuery ? {
      query: exportQuery,
      label: `Exportar itens disponiveis com "${exportQuery}"`,
      estimatedRows: exportRows.length,
    } : null,
  };
}

function buildRulesAnswer(
  message: string,
  products: PurchaseAssistantProductMatch[],
  suppliers: PurchaseAssistantSupplierMatch[],
  offers: PurchaseAssistantSupplierOffer[],
  importedRows: PurchaseAssistantImportedDataMatch[],
  quoteOpportunities: PurchaseAssistantQuoteOpportunity[],
  exportSuggestion: PurchaseAssistantExportSuggestion | null,
) {
  const intro = products.length
    ? `Encontrei ${products.length} produto(s) que batem com o pedido.`
    : "Ainda nao achei produto cadastrado com esse termo.";
  const supplierIntro = suppliers.length
    ? `Tambem encontrei ${suppliers.length} fornecedor(es)/condicao(oes) relacionados.`
    : "Nao encontrei fornecedor ativo diretamente relacionado ao termo.";
  const bestProduct = products[0];
  const bestSupplier = suppliers[0];
  const recommendation = bestProduct
    ? `Minha primeira sugestao e olhar ${bestProduct.description}${bestProduct.brand ? ` (${bestProduct.brand})` : ""}: compra ${money(bestProduct.purchasePrice)}, venda ${money(bestProduct.salePrice)}${bestProduct.marginPercent === null ? "" : `, margem aprox. ${bestProduct.marginPercent.toFixed(2).replace(".", ",")}%`}.`
    : "Para eu fechar uma sugestao melhor, me mande produto, marca, EAN, categoria ou fornecedor.";
  const stockLine = bestProduct?.stockSignal
    ? `Sinal de estoque: ${bestProduct.stockSignal.totalStock} un., media ${bestProduct.stockSignal.monthlySales.toFixed(2).replace(".", ",")} venda/mes, cobertura media ${formatDays(bestProduct.stockSignal.avgStockDays)}. ${bestProduct.suggestedAction}`
    : "Sinal de estoque: sem snapshot suficiente para calcular cobertura.";
  const supplierLine = bestSupplier
    ? `Para negociacao, comece por ${bestSupplier.supplierName}: prazo ${bestSupplier.paymentTerms}${bestSupplier.minOrderValue ? `, pedido minimo ${money(bestSupplier.minOrderValue)}` : ""}.`
    : "Se quiser, posso procurar por categoria ou fornecedor especifico na proxima mensagem.";
  const bestOffer = offers[0];
  const offerLine = bestOffer
    ? `Oferta fornecedor: ${bestOffer.supplierName} tem ${bestOffer.description} por ${money(bestOffer.priceNf || bestOffer.listPrice)}, estoque informado ${bestOffer.availableStock || 0}${bestOffer.deliveryType ? `, entrega ${bestOffer.deliveryType}` : ""}.`
    : "Oferta fornecedor: ainda nao encontrei catalogo/oferta importada para esse termo.";
  const bestImported = importedRows[0];
  const importedLine = bestImported
    ? `Dados importados: encontrei linha em ${bestImported.sourceTitle}, linha ${bestImported.rowNumber}: ${bestImported.preview.map((item) => `${item.label}=${item.value}`).join("; ")}.`
    : "Dados importados: nenhuma linha generica bateu com esse termo.";
  const bestQuote = quoteOpportunities[0];
  const quoteLine = bestQuote
    ? `Cotacao: melhor oportunidade em ${bestQuote.bestSupplier} por ${money(bestQuote.bestPrice)}${bestQuote.bestStock === null ? "" : `, estoque ${bestQuote.bestStock}`}. ${bestQuote.recommendation}`
    : "Cotacao: preciso de pelo menos um preco importado para comparar fornecedores.";
  const exportLine = exportSuggestion
    ? `Exportacao: posso gerar uma planilha com ${exportSuggestion.estimatedRows} item(ns) disponiveis para "${exportSuggestion.query}". Use o botao de exportar na lateral.`
    : "";
  return `${intro} ${supplierIntro}\n\n${recommendation}\n\n${stockLine}\n\n${offerLine}\n\n${importedLine}\n\n${quoteLine}${exportLine ? `\n\n${exportLine}` : ""}\n\n${supplierLine}\n\nPedido analisado: "${message.trim()}".`;
}

function buildAiSetupAnswer(message: string) {
  return [
    "Mano, aqui ainda nao estou rodando como IA de verdade: falta configurar `OPENAI_API_KEY` no servidor.",
    "Sem essa chave eu so consigo usar regras internas e dados importados, por isso as respostas ficam repetitivas e limitadas.",
    "Para ativar a IA real, coloque `OPENAI_API_KEY=...` no `.env.local` e tambem nas variaveis do Vercel/producao, depois reinicie o servidor.",
    `Seu pedido foi: "${message.trim()}". Assim que a chave estiver configurada, eu consigo responder em linguagem natural cruzando estoque, ofertas, fornecedores, cotacao e arquivos importados.`,
  ].join("\n\n");
}

function buildInsights(
  products: PurchaseAssistantProductMatch[],
  suppliers: PurchaseAssistantSupplierMatch[],
  offers: PurchaseAssistantSupplierOffer[],
  importedRows: PurchaseAssistantImportedDataMatch[],
  quoteOpportunities: PurchaseAssistantQuoteOpportunity[],
  exportSuggestion: PurchaseAssistantExportSuggestion | null,
): PurchaseAssistantInsight[] {
  const lowCoverage = products.reduce((sum, product) => sum + (product.stockSignal?.lowCoverageStores || 0), 0);
  const excess = products.reduce((sum, product) => sum + (product.stockSignal?.excessStores || 0), 0);
  const staleSales = products.reduce((sum, product) => sum + (product.stockSignal?.staleSaleStores || 0), 0);
  const recentPurchases = products.reduce((sum, product) => sum + (product.stockSignal?.recentPurchaseStores || 0), 0);
  const lowMargin = products.filter((product) => product.marginPercent !== null && product.marginPercent < 20).length;
  const availableOffers = offers.filter((offer) => offer.availableStock > 0).length;
  const insights: PurchaseAssistantInsight[] = [];

  if (lowCoverage > 0) {
    insights.push({
      id: "low-coverage",
      title: "Risco de ruptura",
      description: `${lowCoverage} loja(s) com cobertura ate 15 dias nos produtos encontrados.`,
      tone: "red",
    });
  }

  if (excess > 0) {
    insights.push({
      id: "excess-stock",
      title: "Olhar remanejamento",
      description: `${excess} loja(s) com excesso ou giro parado antes de comprar mais.`,
      tone: "amber",
    });
  }

  if (staleSales > 0) {
    insights.push({
      id: "stale-sales",
      title: "Venda antiga",
      description: `${staleSales} loja(s) sem venda ha 90 dias ou mais no snapshot.`,
      tone: "slate",
    });
  }

  if (recentPurchases > 0) {
    insights.push({
      id: "recent-purchase",
      title: "Compra recente",
      description: `${recentPurchases} loja(s) tiveram compra nos ultimos 30 dias. Vale conferir pedido pendente.`,
      tone: "blue",
    });
  }

  if (lowMargin > 0) {
    insights.push({
      id: "low-margin",
      title: "Margem apertada",
      description: `${lowMargin} produto(s) com margem estimada abaixo de 20%.`,
      tone: "amber",
    });
  }

  if (suppliers.length > 0) {
    insights.push({
      id: "supplier-ready",
      title: "Fornecedor mapeado",
      description: `${suppliers.length} fornecedor(es) ativo(s) com prazo/contato para negociar.`,
      tone: "green",
    });
  }

  if (availableOffers > 0) {
    insights.push({
      id: "supplier-offers",
      title: "Oferta importada",
      description: `${availableOffers} item(ns) com estoque/preco de fornecedor no catalogo ativo.`,
      tone: "green",
    });
  }

  if (importedRows.length > 0) {
    insights.push({
      id: "generic-import",
      title: "Dado importado",
      description: `${importedRows.length} linha(s) de importacoes genericas bateram com a pergunta.`,
      tone: "blue",
    });
  }

  if (quoteOpportunities.length > 0) {
    const bestQuote = quoteOpportunities[0];
    insights.push({
      id: "quote-opportunity",
      title: "Melhor compra",
      description: `${bestQuote.bestSupplier} lidera cotacao por ${money(bestQuote.bestPrice)}.`,
      tone: "green",
    });
  }

  if (exportSuggestion) {
    insights.push({
      id: "export-ready",
      title: "Planilha pronta",
      description: `${exportSuggestion.estimatedRows} item(ns) disponiveis encontrados para exportacao.`,
      tone: "blue",
    });
  }

  if (!insights.length) {
    insights.push({
      id: "needs-context",
      title: "Falta contexto",
      description: "Envie EAN, marca, categoria ou fornecedor para cruzar preco, estoque e prazo.",
      tone: "slate",
    });
  }

  return insights.slice(0, 5);
}

function buildPlan(
  products: PurchaseAssistantProductMatch[],
  suppliers: PurchaseAssistantSupplierMatch[],
  offers: PurchaseAssistantSupplierOffer[],
  importedRows: PurchaseAssistantImportedDataMatch[],
  quoteOpportunities: PurchaseAssistantQuoteOpportunity[],
  exportSuggestion: PurchaseAssistantExportSuggestion | null,
): PurchaseAssistantPlanItem[] {
  const bestProduct = products[0];
  const bestSupplier = suppliers[0];
  const bestOffer = offers[0];
  const bestImported = importedRows[0];
  const bestQuote = quoteOpportunities[0];
  const plan: PurchaseAssistantPlanItem[] = [];

  if (bestProduct) {
    plan.push({
      id: "priority-product",
      label: "Item foco",
      value: bestProduct.description,
      detail: bestProduct.suggestedAction,
    });
  }

  if (bestProduct?.stockSignal) {
    plan.push({
      id: "coverage",
      label: "Cobertura media",
      value: formatDays(bestProduct.stockSignal.avgStockDays),
      detail: `${bestProduct.stockSignal.totalStock} un. em estoque e media ${bestProduct.stockSignal.monthlySales.toFixed(2).replace(".", ",")} venda/mes.`,
    });
  }

  if (bestSupplier) {
    plan.push({
      id: "supplier",
      label: "Negociar com",
      value: bestSupplier.supplierName,
      detail: `Prazo ${bestSupplier.paymentTerms}${bestSupplier.minOrderValue ? `, minimo ${money(bestSupplier.minOrderValue)}` : ""}.`,
    });
  }

  if (bestOffer) {
    plan.push({
      id: "supplier-offer",
      label: "Oferta ativa",
      value: `${bestOffer.supplierName} ${money(bestOffer.priceNf || bestOffer.listPrice)}`,
      detail: `${bestOffer.description}${bestOffer.availableStock ? `, estoque ${bestOffer.availableStock}` : ""}${bestOffer.deliveryType ? `, entrega ${bestOffer.deliveryType}` : ""}.`,
    });
  }

  if (bestImported) {
    plan.push({
      id: "generic-import",
      label: "Dado importado",
      value: bestImported.sourceTitle,
      detail: bestImported.preview.slice(0, 4).map((item) => `${item.label}: ${item.value}`).join(" | "),
    });
  }

  if (bestQuote) {
    plan.push({
      id: "quote-opportunity",
      label: "Melhor cotacao",
      value: `${bestQuote.bestSupplier} ${money(bestQuote.bestPrice)}`,
      detail: bestQuote.recommendation,
    });
  }

  if (exportSuggestion) {
    plan.push({
      id: "export",
      label: "Exportacao",
      value: exportSuggestion.label,
      detail: `${exportSuggestion.estimatedRows} item(ns) disponiveis serao incluidos na planilha.`,
    });
  }

  if (bestProduct) {
    plan.push({
      id: "price-check",
      label: "Trava de decisao",
      value: bestProduct.marginPercent === null ? "Validar preco" : `${bestProduct.marginPercent.toFixed(2).replace(".", ",")}% margem`,
      detail: "Fechar pedido so depois de validar preco de compra, quantidade e pedido pendente.",
    });
  }

  return plan.slice(0, 4);
}

function buildNextActions(
  products: PurchaseAssistantProductMatch[],
  suppliers: PurchaseAssistantSupplierMatch[],
  offers: PurchaseAssistantSupplierOffer[],
  importedRows: PurchaseAssistantImportedDataMatch[],
  quoteOpportunities: PurchaseAssistantQuoteOpportunity[],
  exportSuggestion: PurchaseAssistantExportSuggestion | null,
) {
  const actions = [
    "Confirmar quantidade desejada e urgencia da compra.",
    "Validar preco de compra com fornecedor antes de fechar pedido.",
  ];

  if (products.some((product) => (product.stockSignal?.lowCoverageStores || 0) > 0)) {
    actions.push("Separar lojas com cobertura baixa e checar se ha estoque sobrando para remanejar.");
  } else if (products.length) {
    actions.push("Comparar margem, cobertura e estoque dos produtos encontrados.");
  }
  if (suppliers.length) actions.push("Checar prazo de boleto, pedido minimo e contato do fornecedor.");
  if (offers.length) actions.push("Comparar oferta importada com margem, cobertura e pedidos pendentes.");
  if (importedRows.length) actions.push("Usar as linhas importadas para responder preco, EAN, estoque ou codigo especifico.");
  if (quoteOpportunities.length) actions.push("Confirmar validade, estoque e prazo da melhor cotacao antes de fechar pedido.");
  if (exportSuggestion) actions.push("Baixar a planilha e conferir se os itens exportados batem com o filtro.");
  if (!products.length) actions.push("Tentar buscar por EAN, fabricante ou descricao mais curta.");

  return actions.slice(0, 4);
}

async function generateAiAnswer(
  request: PurchaseAssistantRequest,
  products: PurchaseAssistantProductMatch[],
  suppliers: PurchaseAssistantSupplierMatch[],
  offers: PurchaseAssistantSupplierOffer[],
  importedRows: PurchaseAssistantImportedDataMatch[],
  quoteOpportunities: PurchaseAssistantQuoteOpportunity[],
  exportSuggestion: PurchaseAssistantExportSuggestion | null,
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.PURCHASE_ASSISTANT_MODEL || "gpt-4.1-mini";
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [
              "Voce e um assistente de compras interno.",
              "Responda em portugues do Brasil, de forma objetiva e operacional.",
              "Use apenas os dados de contexto enviados. Quando faltar dado, diga o que precisa confirmar.",
              "Priorize sinais de cobertura, ultima venda, ultima compra, margem e fornecedor antes de sugerir compra.",
              "Use ofertas importadas de fornecedores quando existirem; elas podem conter preco, estoque, entrega e validade.",
              "Use dados genericos importados quando a pergunta pedir preco especifico, EAN, estoque, codigo, coluna ou valor de arquivo.",
              "Quando houver cotacoes do mesmo item em fornecedores diferentes, compare preco, estoque, entrega e validade. Recomende a melhor oportunidade de compra e explique o motivo.",
              "Se houver excesso em lojas, recomende checar remanejamento antes de comprar mais.",
              "Nao invente fornecedor, preco, estoque ou prazo.",
            ].join("\n"),
          },
          ...((request.history || []).slice(-6).map((item) => ({
            role: item.role,
            content: item.content,
          }))),
          {
            role: "user",
            content: JSON.stringify({
              pedido: request.message,
              produtos_encontrados: products,
              fornecedores_encontrados: suppliers,
              ofertas_fornecedores: offers,
              dados_importados_genericos: importedRows,
              cotacoes_comparadas: quoteOpportunities,
              exportacao_sugerida: exportSuggestion,
            }),
          },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) return null;
    const data = await response.json() as { output_text?: string };
    return data.output_text?.trim() || null;
  } catch {
    return null;
  }
}

export async function runPurchaseAssistant(request: PurchaseAssistantRequest): Promise<PurchaseAssistantResponse> {
  const message = request.message.trim();
  if (!message) {
    return {
      answer: "Me diga o que voce quer comprar, uma marca, EAN, fornecedor ou categoria.",
      products: [],
      suppliers: [],
      offers: [],
      importedRows: [],
      quoteOpportunities: [],
      exportSuggestion: null,
      insights: buildInsights([], [], [], [], [], null),
      plan: [],
      nextActions: ["Enviar uma descricao do item ou fornecedor."],
      mode: "rules",
    };
  }

  const context = await loadContext(message);
  const aiConfigured = isOpenAiConfigured();
  const aiAnswer = aiConfigured
    ? await generateAiAnswer(request, context.products, context.suppliers, context.offers, context.importedRows, context.quoteOpportunities, context.exportSuggestion)
    : null;

  return {
    answer: aiAnswer
      || (aiConfigured
        ? buildRulesAnswer(message, context.products, context.suppliers, context.offers, context.importedRows, context.quoteOpportunities, context.exportSuggestion)
        : buildAiSetupAnswer(message)),
    products: context.products,
    suppliers: context.suppliers,
    offers: context.offers,
    importedRows: context.importedRows,
    quoteOpportunities: context.quoteOpportunities,
    exportSuggestion: context.exportSuggestion,
    insights: buildInsights(context.products, context.suppliers, context.offers, context.importedRows, context.quoteOpportunities, context.exportSuggestion),
    plan: buildPlan(context.products, context.suppliers, context.offers, context.importedRows, context.quoteOpportunities, context.exportSuggestion),
    nextActions: buildNextActions(context.products, context.suppliers, context.offers, context.importedRows, context.quoteOpportunities, context.exportSuggestion),
    mode: aiAnswer ? "ai" : aiConfigured ? "rules" : "setup",
  };
}
