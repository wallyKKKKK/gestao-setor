import { reviewQuotation, type QuotationDraft } from '@/lib/purchase-quotation-import';

export type SupplierItem = { id: string; code: string; ean: string; description: string; quantity: number };
export type SupplierOffer = { itemId: string; unitPrice: number | null; available: number | null; multiple: number | null; note: string };
export type SupplierProposal = { paymentDays: number | null; deliveryDays: number | null; note: string; offers: SupplierOffer[]; unavailableItemIds?: string[] };
export type QuotationSupplier = {
  id: string; cnpj: string; name: string; contact: string; email: string; whatsapp: string; coverage: string; minimum_order: number; payment_days: number;
};
export type QuotationInvite = {
  id: string; supplier_id: string; supplier_name: string; expires_at: string; revoked_at: string | null; submitted_at: string | null; revision: number;
  round: { title: string; draft_revision: number };
};

export function buildQuotationRound(draft: QuotationDraft) {
  const review = reviewQuotation(draft);
  if (!review.rows.length) throw new Error('Importe e salve um TXT antes de gerar convites.');
  if (review.rows.some(row => !row.ean || row.duplicate)) throw new Error('O TXT tem itens sem EAN ou duplicados na mesma loja. Corrija o arquivo antes de enviar.');
  const groups = new Map<string, SupplierItem>();
  const buyerItems = review.rows.map(row => {
    const key = JSON.stringify([row.productCode, row.ean]);
    let item = groups.get(key);
    if (!item) {
      item = { id: String(groups.size + 1), code: row.productCode, ean: row.ean, description: row.description, quantity: 0 };
      groups.set(key, item);
    }
    item.quantity += row.quantity;
    return { itemId: item.id, branchCnpj: row.branchCnpj, quantity: row.quantity, a7Reference: row.a7Reference, cost: row.cost ?? null };
  });
  if (groups.size > 2000) throw new Error('Divida a cotação em lotes de até 2.000 itens distintos.');
  return { buyerItems, supplierItems: [...groups.values()] };
}

export function quotationObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Dados inválidos.');
  return value as Record<string, unknown>;
}

function limitedText(value: unknown, max: number) {
  if (typeof value !== 'string' || value.trim().length > max) throw new Error('Preencha os campos de texto dentro dos limites.');
  return value.trim();
}

function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('Informe quantidades e prazos inteiros válidos.');
  return value;
}

export function normalizeQuotationSupplier(input: unknown): Omit<QuotationSupplier, 'id'> {
  const body = quotationObject(input);
  const cnpj = limitedText(body.cnpj, 24).toUpperCase().replace(/[.\s/\-]/g, '');
  const name = limitedText(body.name, 200);
  const email = limitedText(body.email, 254);
  const minimum = body.minimum_order;
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || !name) throw new Error('Informe a razão social e um CNPJ com 14 caracteres.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe um e-mail válido.');
  if (typeof minimum !== 'number' || !Number.isFinite(minimum) || minimum < 0 || minimum > 999999999999) throw new Error('Informe um faturamento mínimo válido.');
  return {
    cnpj, name, email, minimum_order: Math.round(minimum * 100) / 100,
    contact: limitedText(body.contact, 120), whatsapp: limitedText(body.whatsapp, 40), coverage: limitedText(body.coverage, 500),
    payment_days: integer(body.payment_days, 0, 3650),
  };
}

export function normalizeSupplierProposal(input: unknown, items: SupplierItem[], allowIncomplete = false): SupplierProposal {
  const body = quotationObject(input);
  const allowed = new Set(items.map(item => item.id));
  const seen = new Set<string>();
  if (!Array.isArray(body.offers) || body.offers.length > allowed.size) throw new Error('A proposta contém itens inválidos.');
  const offers = body.offers.map(value => {
    const offer = quotationObject(value);
    const { itemId, unitPrice } = offer;
    if (typeof itemId !== 'string' || !allowed.has(itemId) || seen.has(itemId)) throw new Error('A proposta contém itens inválidos ou repetidos.');
    seen.add(itemId);
    const price = unitPrice === null && allowIncomplete ? null : unitPrice;
    if ((price !== null || !allowIncomplete) && (typeof price !== 'number' || !Number.isFinite(price) || price < 0.0001 || price > 9999999)) throw new Error('Informe um preço unitário positivo para os itens cotados.');
    return {
      itemId, unitPrice: typeof price === 'number' ? Number(price.toFixed(4)) : null,
      available: allowIncomplete && offer.available === null ? null : integer(offer.available, 1, 9999999),
      multiple: allowIncomplete && offer.multiple === null ? null : integer(offer.multiple, 1, 9999999),
      note: limitedText(offer.note, 300),
    };
  });
  const unavailable = body.unavailableItemIds ?? [];
  if (!Array.isArray(unavailable) || unavailable.length > allowed.size) throw new Error('A disponibilidade contém itens inválidos.');
  const unavailableItemIds = unavailable.map(itemId => {
    if (typeof itemId !== 'string' || !allowed.has(itemId) || seen.has(itemId)) {
      throw new Error('A disponibilidade contém itens inválidos, repetidos ou já cotados.');
    }
    seen.add(itemId);
    return itemId;
  });
  const optionalTerms = allowIncomplete || offers.length === 0;
  return {
    offers, unavailableItemIds, note: limitedText(body.note, 1000),
    paymentDays: optionalTerms && body.paymentDays === null ? null : integer(body.paymentDays, 0, 3650),
    deliveryDays: optionalTerms && body.deliveryDays === null ? null : integer(body.deliveryDays, 0, 3650),
  };
}
