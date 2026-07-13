import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { parseLocaleNumber } from "@/lib/number";

export interface SupplierWebOffer {
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

interface SearchConnectorOptions {
  query: string;
  persist?: boolean;
  importedBy?: string;
}

interface ConnectorConfig {
  supplierName: string;
  sourceSystem: string;
  searchUrl?: string;
  detailUrl?: string;
  searchIndex?: string;
  method: "GET" | "POST";
  searchStyle?: "default" | "algolia";
  authHeader?: string;
  authToken?: string;
  cookie?: string;
}

const DEFAULT_MATEUS_MAIS_SEARCH_URL = "https://app.mateusmais.com.br/api/products/internal/v1/service/";
const DEFAULT_MATEUS_MAIS_DETAIL_URL = "https://app.mateusmais.com.br/api/products/product-detail/{id}/";

function normalize(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function stringValue(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function numberValue(value: unknown) {
  return parseLocaleNumber(value);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Casa o alias como palavra inteira, evitando que aliases curtos (ex.: "st")
// grudem em chaves não relacionadas ("estoque", "custo", "indisponivel").
function keyMatchesAlias(normalizedKey: string, alias: string) {
  if (!alias) return false;
  if (normalizedKey === alias) return true;
  return new RegExp(`(^|[^A-Z0-9])${escapeRegExp(alias)}([^A-Z0-9]|$)`).test(normalizedKey);
}

function getValue(record: Record<string, unknown>, aliases: string[]) {
  const normalizedAliases = aliases.map(normalize);
  const entry = Object.entries(record).find(([key]) => {
    const normalizedKey = normalize(key);
    return normalizedAliases.some((alias) => keyMatchesAlias(normalizedKey, alias));
  });

  return entry?.[1];
}

function collectObjects(value: unknown, output: Record<string, unknown>[] = []) {
  if (!value || output.length >= 80) return output;

  if (Array.isArray(value)) {
    value.forEach((item) => collectObjects(item, output));
    return output;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).map(normalize).join(" ");
    const looksProductLike = (
      keys.includes("EAN")
      || keys.includes("BARRA")
      || keys.includes("BARCODE")
      || keys.includes("SKU")
      || keys.includes("CODIGO")
      || keys.includes("PRODUTO")
      || keys.includes("NAME")
      || keys.includes("DESCR")
    ) && (
      keys.includes("PRECO")
      || keys.includes("PRICE")
      || keys.includes("VALOR")
      || keys.includes("ESTOQUE")
      || keys.includes("AMOUNT IN STOCK")
      || keys.includes("SALDO")
    );

    if (looksProductLike) output.push(record);
    Object.values(record).forEach((item) => collectObjects(item, output));
  }

  return output;
}

function connectorConfigMateusMais(): ConnectorConfig {
  return {
    supplierName: "MATEUS MAIS",
    sourceSystem: "MATEUS MAIS WEB",
    searchUrl: process.env.MATEUS_MAIS_SEARCH_URL || DEFAULT_MATEUS_MAIS_SEARCH_URL,
    detailUrl: process.env.MATEUS_MAIS_DETAIL_URL || DEFAULT_MATEUS_MAIS_DETAIL_URL,
    searchIndex: process.env.MATEUS_MAIS_SEARCH_INDEX || "SHOWCASE_catalog_product_api_index_PROD",
    method: (process.env.MATEUS_MAIS_SEARCH_METHOD || "GET").toUpperCase() === "POST" ? "POST" : "GET",
    searchStyle: process.env.MATEUS_MAIS_SEARCH_STYLE === "algolia" ? "algolia" : "default",
    authHeader: process.env.MATEUS_MAIS_AUTH_HEADER,
    authToken: process.env.MATEUS_MAIS_AUTH_TOKEN,
    cookie: process.env.MATEUS_MAIS_COOKIE,
  };
}

function isConfigured(config: ConnectorConfig) {
  return Boolean(config.searchUrl);
}

function urlWithQuery(searchUrl: string, query: string) {
  if (searchUrl.includes("{query}")) return searchUrl.replace("{query}", encodeURIComponent(query));
  const url = new URL(searchUrl);
  if (!url.searchParams.has("q") && !url.searchParams.has("search") && !url.searchParams.has("termo")) {
    url.searchParams.set("q", query);
  }
  return url.toString();
}

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function requestBodyFor(config: ConnectorConfig, query: string) {
  if (config.searchStyle === "algolia") {
    return JSON.stringify({
      requests: [
        {
          indexName: config.searchIndex,
          query,
          params: "highlightPreTag=<em>&highlightPostTag=</em>&hitsPerPage=20",
        },
      ],
    });
  }

  return JSON.stringify({ query, search: query, termo: query });
}

function detailUrlWithId(detailUrl: string, id: string) {
  return detailUrl.includes("{id}") ? detailUrl.replace("{id}", encodeURIComponent(id)) : detailUrl;
}

function normalizeOffer(config: ConnectorConfig, record: Record<string, unknown>): SupplierWebOffer | null {
  const description = stringValue(getValue(record, ["descricao", "descricao produto", "produto", "nome", "description", "name"])).toUpperCase();
  const ean = stringValue(getValue(record, ["ean", "gtin", "codigo barras", "cod barras", "barcode"])).replace(/[^\dA-Za-z]/g, "");
  const supplierSku = stringValue(getValue(record, ["codigo", "cod produto", "sku", "id produto", "produto id"])).replace(/[^\dA-Za-z]/g, "");
  const priceNf = numberValue(getValue(record, ["preco nf", "preco", "valor nf", "valor", "price", "sale price"]));
  const listPrice = numberValue(getValue(record, ["preco tabela", "preco bruto", "list price", "base", "max price"]));
  const availableStock = numberValue(getValue(record, ["estoque", "saldo", "disponivel", "stock", "quantity", "amount in stock", "amount_in_stock"]));
  const forSale = getValue(record, ["for_sale", "for sale"]);

  if (!description || (!ean && !supplierSku) || (!priceNf && !listPrice && !availableStock)) return null;

  return {
    supplierName: stringValue(getValue(record, ["supplier", "supplier external name", "supplier_external_name", "fornecedor"])) || config.supplierName,
    sourceSystem: config.sourceSystem,
    ean,
    supplierSku,
    description,
    manufacturer: stringValue(getValue(record, ["laboratorio", "fabricante", "marca", "industria", "brand"])).toUpperCase(),
    category: stringValue(getValue(record, ["categoria", "departamento", "linha", "category", "section name", "section_name"])).toUpperCase(),
    deliveryType: stringValue(getValue(record, ["entrega", "prazo entrega", "delivery"])).toUpperCase(),
    availableStock,
    priceNf,
    listPrice,
    discountPercent: numberValue(getValue(record, ["desconto", "discount"])),
    stValue: numberValue(getValue(record, ["st", "subst tributaria"])),
    minimumQuantity: numberValue(getValue(record, ["quantidade minima", "qtd minima", "minimo", "multiple", "multiplo"])),
    offerType: forSale === false
      ? "INDISPONIVEL PARA VENDA"
      : stringValue(getValue(record, ["oferta", "promocao", "condicao", "price_table"])).toUpperCase(),
    offerValidUntil: null,
    importedAt: new Date().toISOString(),
  };
}

async function persistOffers(offers: SupplierWebOffer[], importedBy?: string) {
  if (!offers.length) return;

  const supabase = getSupabaseAdmin();
  const rows = offers.map((offer) => ({
    supplier_name: offer.supplierName,
    source_system: offer.sourceSystem,
    source_file: "web-connector",
    row_key: normalize([offer.supplierName, offer.supplierSku || offer.ean || offer.description].join("|")).slice(0, 220),
    ean: offer.ean,
    supplier_sku: offer.supplierSku,
    description: offer.description,
    manufacturer: offer.manufacturer,
    category: offer.category,
    delivery_type: offer.deliveryType,
    available_stock: offer.availableStock,
    price_nf: offer.priceNf,
    list_price: offer.listPrice,
    discount_percent: offer.discountPercent,
    st_value: offer.stValue,
    minimum_quantity: offer.minimumQuantity,
    offer_type: offer.offerType,
    offer_valid_until: offer.offerValidUntil,
    is_active: true,
    imported_by: importedBy || null,
    imported_at: offer.importedAt,
  }));

  await supabase
    .from("supplier_catalog_items")
    .upsert(rows, { onConflict: "supplier_name,row_key" });
}

async function fetchDetailOffers(config: ConnectorConfig, records: Record<string, unknown>[], headers: Record<string, string>) {
  if (!config.detailUrl) return [] as SupplierWebOffer[];

  const ids = Array.from(new Set(
    records
      .map((record) => stringValue(record.objectID || record.id))
      .filter((id) => looksLikeUuid(id)),
  )).slice(0, 12);
  const offers: SupplierWebOffer[] = [];

  for (const id of ids) {
    const response = await fetch(detailUrlWithId(config.detailUrl, id), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(12000),
    }).catch(() => null);

    if (!response?.ok) continue;

    const payload = await response.json().catch(() => null) as unknown;
    collectObjects(payload)
      .map((record) => normalizeOffer(config, record))
      .filter((offer): offer is SupplierWebOffer => Boolean(offer))
      .forEach((offer) => offers.push(offer));
  }

  return offers;
}

export function isMateusMaisConnectorConfigured() {
  return isConfigured(connectorConfigMateusMais());
}

export async function searchMateusMaisConnector({ query, persist = false, importedBy }: SearchConnectorOptions) {
  const config = connectorConfigMateusMais();
  if (!isConfigured(config)) return [] as SupplierWebOffer[];
  const searchUrl = config.searchUrl as string;

  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
  };

  if (config.authHeader && config.authToken) headers[config.authHeader] = config.authToken;
  if (config.cookie) headers.Cookie = config.cookie;

  const requestUrl = config.detailUrl && looksLikeUuid(query)
    ? detailUrlWithId(config.detailUrl, query)
    : config.method === "GET" ? urlWithQuery(searchUrl, query) : searchUrl;
  const requestMethod = config.detailUrl && looksLikeUuid(query) ? "GET" : config.method;

  const response = await fetch(
    requestUrl,
    {
      method: requestMethod,
      headers,
      body: requestMethod === "POST" ? requestBodyFor(config, query) : undefined,
      signal: AbortSignal.timeout(12000),
    },
  );

  if (!response.ok) return [];

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("json") ? await response.json() as unknown : await response.text();
  const records = collectObjects(payload);
  const directOffers = records
    .map((record) => normalizeOffer(config, record))
    .filter((offer): offer is SupplierWebOffer => Boolean(offer))
    .slice(0, 20);
  const detailOffers = await fetchDetailOffers(config, records, headers);
  const offers = [...detailOffers, ...directOffers].slice(0, 20);

  if (persist) await persistOffers(offers, importedBy);
  return offers;
}
