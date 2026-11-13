import type { SupplierItem, SupplierProposal } from '@/lib/purchase-quotation-supplier';

export type BuyerItem = { itemId: string; branchCnpj: string; quantity: number; a7Reference: number; cost: { unitCost: number } | null };
export type SettlementInvite = {
  supplier_id: string; supplier_name: string; minimum_order: number; expires_at: string;
  revoked_at: string | null; submitted_at: string | null; proposal: SupplierProposal | null;
};
export type ItemDecision = {
  supplierId?: string | null;
  quantities?: Record<string, number>;
  unitsPerPackage?: number;
  reason?: string;
  approval?: string;
  approvalBasis?: string;
};
export type SettlementDecisions = { items: Record<string, ItemDecision>; minimumApprovals: Record<string, { reason: string; totalCents: number }> };
export const emptySettlement: SettlementDecisions = { items: {}, minimumApprovals: {} };
export type OrderLine = {
  itemId: string; code: string; ean: string; description: string; branchCnpj: string;
  originalQuantity: number; quantity: number; unitPrice: number; totalCents: number;
  a7Reference: number; referenceUnitCost: number | null; unitsPerPackage: number | null;
};
export type QuotationOrder = {
  supplierId: string; supplierName: string; minimumCents: number; totalCents: number;
  paymentDays: number | null; deliveryDays: number | null; lines: OrderLine[];
};
export type SettlementRound = { id: string; title: string; draft_revision: number; buyer_items: BuyerItem[]; supplier_items: SupplierItem[] };
export type SettlementRecord = { revision: number; decisions: SettlementDecisions; orders: QuotationOrder[] | null; closed_at: string | null };

export function groupQuotationOrderByBranch(order: QuotationOrder, branchNames: ReadonlyMap<string, string>) {
  const branches = new Map<string, { cnpj: string; name: string; totalCents: number; lines: OrderLine[] }>();
  for (const line of order.lines) {
    const cnpj = line.branchCnpj.replace(/\D/g, '') || line.branchCnpj;
    const branch = branches.get(cnpj) ?? { cnpj, name: branchNames.get(cnpj) || cnpj, totalCents: 0, lines: [] };
    branch.totalCents += line.totalCents;
    branch.lines.push(line);
    branches.set(cnpj, branch);
  }
  return [...branches.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }) || a.cnpj.localeCompare(b.cnpj));
}

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Dados de apuração inválidos.');
  return value as Record<string, unknown>;
};
const reason = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 500) throw new Error('O motivo deve ter até 500 caracteres.');
  return value.trim();
};
const validInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const lineTotalCents = (price: number, quantity: number) =>
  Number((BigInt(Math.round(price * 10000)) * BigInt(quantity) + BigInt(50)) / BigInt(100));

export function normalizeSettlement(input: unknown, round: SettlementRound, invites: SettlementInvite[]): SettlementDecisions {
  const body = asObject(input);
  const branches = new Map<string, Set<string>>();
  for (const row of round.buyer_items) {
    const list = branches.get(row.itemId) ?? new Set<string>();
    list.add(row.branchCnpj); branches.set(row.itemId, list);
  }
  const suppliers = new Set(invites.filter(invite => invite.submitted_at && invite.proposal).map(invite => invite.supplier_id));
  const items = Object.fromEntries(Object.entries(asObject(body.items)).map(([id, value]) => {
    const allowed = branches.get(id);
    if (!allowed) throw new Error('Item não pertence à cotação.');
    const input = asObject(value);
    const decision: ItemDecision = {};
    if (input.supplierId !== undefined) {
      if (input.supplierId !== null && (typeof input.supplierId !== 'string' || !suppliers.has(input.supplierId))) throw new Error('Fornecedor sem resposta nesta cotação.');
      decision.supplierId = input.supplierId;
    }
    if (input.quantities !== undefined) {
      decision.quantities = Object.fromEntries(Object.entries(asObject(input.quantities)).map(([branch, quantity]) => {
        if (!allowed.has(branch) || !validInt(quantity, 0, 9999999)) throw new Error('Informe quantidades inteiras válidas para as lojas do item.');
        return [branch, quantity];
      }));
    }
    if (input.unitsPerPackage !== undefined) {
      if (!validInt(input.unitsPerPackage, 1, 999999)) throw new Error('Informe a quantidade de unidades por embalagem.');
      decision.unitsPerPackage = input.unitsPerPackage;
    }
    if (input.reason !== undefined) decision.reason = reason(input.reason);
    if (input.approval !== undefined) decision.approval = reason(input.approval);
    if (input.approvalBasis !== undefined) decision.approvalBasis = reason(input.approvalBasis);
    return [id, decision];
  }));
  const minimumApprovals = Object.fromEntries(Object.entries(asObject(body.minimumApprovals)).map(([id, value]) => {
    if (!suppliers.has(id)) throw new Error('Fornecedor inválido para liberação de mínimo.');
    const approval = asObject(value);
    if (!validInt(approval.totalCents, 0, Number.MAX_SAFE_INTEGER)) throw new Error('Total inválido para liberação de mínimo.');
    return [id, { reason: reason(approval.reason), totalCents: approval.totalCents }];
  }));
  return { items, minimumApprovals };
}

export function assessQuotation(round: SettlementRound, invites: SettlementInvite[], decisions: SettlementDecisions) {
  const linesByItem = new Map<string, BuyerItem[]>();
  for (const row of round.buyer_items) {
    const list = linesByItem.get(row.itemId) ?? [];
    list.push(row); linesByItem.set(row.itemId, list);
  }
  const supplierOffers = new Map<string, Array<{
    supplier: SettlementInvite; unitPrice: number; available: number; multiple: number; paymentDays: number | null; deliveryDays: number | null;
  }>>();
  for (const invite of invites) {
    if (!invite.submitted_at || !invite.proposal || invite.revoked_at) continue;
    const { paymentDays, deliveryDays } = invite.proposal;
    for (const offer of invite.proposal.offers) {
      if (!offer.unitPrice || !offer.available || !offer.multiple) continue;
      const group = supplierOffers.get(offer.itemId) ?? [];
      group.push({ supplier: invite, unitPrice: offer.unitPrice, available: offer.available, multiple: offer.multiple, paymentDays, deliveryDays });
      supplierOffers.set(offer.itemId, group);
    }
  }
  const orders = new Map<string, QuotationOrder>();
  const blockers: string[] = [];
  const rows = round.supplier_items.map(item => {
    const decision = decisions.items[item.id] ?? {};
    const branches = (linesByItem.get(item.id) ?? []).map(row => ({ ...row, finalQuantity: decision.quantities?.[row.branchCnpj] ?? row.quantity }));
    const quantity = branches.reduce((sum, row) => sum + row.finalQuantity, 0);
    const validQuantities = branches.every(row => validInt(row.finalQuantity, 0, 9999999));
    const quotes = (supplierOffers.get(item.id) ?? []).sort((a, b) =>
      a.unitPrice - b.unitPrice || (b.paymentDays ?? -1) - (a.paymentDays ?? -1)
      || (a.deliveryDays ?? Infinity) - (b.deliveryDays ?? Infinity) || a.supplier.supplier_id.localeCompare(b.supplier.supplier_id));
    const options = quotes.map(quote => ({ ...quote, eligible: validQuantities && quantity > 0 && quantity <= quote.available && quantity % quote.multiple === 0 }));
    const suggested = options.find(option => option.eligible);
    const winner = decision.supplierId === undefined ? suggested : options.find(option => option.supplier.supplier_id === decision.supplierId && option.eligible);
    const reference = branches.find(row => row.cost)?.cost?.unitCost ?? null;
    const unitFactor = decision.unitsPerPackage ?? null;
    const referencePerPackage = reference && unitFactor ? reference * unitFactor : null;
    const difference = winner && referencePerPackage !== null
      ? (Math.round(winner.unitPrice * 10000) - Math.round(referencePerPackage * 10000)) / 10000 : null;
    const tag = !winner ? 'Sem compra' : difference === null ? (reference ? 'Confirmar embalagem' : 'Sem referência') : difference > 0 ? 'Não comprar' : 'Comprar';
    const approvalBasis = winner ? JSON.stringify([winner.supplier.supplier_id, winner.unitPrice, unitFactor, quantity]) : '';
    const reasons: string[] = [];
    if (!validQuantities) reasons.push('Quantidade por loja precisa ser inteira e estar dentro do limite.');
    if (decision.supplierId && !winner) reasons.push('Fornecedor não atende quantidade ou múltiplo.');
    const adjusted = branches.some(row => row.quantity !== row.finalQuantity);
    const reassigned = decision.supplierId !== undefined && decision.supplierId !== (suggested?.supplier.supplier_id ?? null);
    if ((adjusted || reassigned) && !decision.reason?.trim()) reasons.push('Informe o motivo do ajuste de quantidade ou fornecedor.');
    if (winner && tag === 'Confirmar embalagem') reasons.push('Confirme as unidades por embalagem para comparar o custo.');
    if (winner && (tag === 'Não comprar' || tag === 'Sem referência') && (!decision.approval?.trim() || decision.approvalBasis !== approvalBasis)) reasons.push('Registre a autorização da compra.');
    if (reasons.length) blockers.push(`${item.description}: ${reasons.join(' ')}`);
    if (winner) {
      const supplierId = winner.supplier.supplier_id;
      const order = orders.get(supplierId) ?? {
        supplierId, supplierName: winner.supplier.supplier_name, minimumCents: Math.round(Number(winner.supplier.minimum_order) * 100),
        totalCents: 0, paymentDays: winner.paymentDays, deliveryDays: winner.deliveryDays, lines: [],
      };
      for (const branch of branches.filter(row => row.finalQuantity > 0)) {
        const totalCents = lineTotalCents(winner.unitPrice, branch.finalQuantity);
        order.totalCents += totalCents;
        order.lines.push({
          itemId: item.id, code: item.code, ean: item.ean, description: item.description, branchCnpj: branch.branchCnpj,
          originalQuantity: branch.quantity, quantity: branch.finalQuantity, unitPrice: winner.unitPrice, totalCents,
          a7Reference: branch.a7Reference, referenceUnitCost: reference, unitsPerPackage: unitFactor,
        });
      }
      orders.set(supplierId, order);
    }
    return { item, branches, quantity, options, winner, reference, difference, tag, reasons, approvalBasis };
  });
  const orderList = [...orders.values()];
  if (orderList.some(order => !Number.isSafeInteger(order.totalCents))) blockers.push('O total de um pedido excede o limite suportado.');
  const minimums = orderList.filter(order => order.totalCents < order.minimumCents).map(order => {
    const approval = decisions.minimumApprovals[order.supplierId];
    if (!approval?.reason.trim() || approval.totalCents !== order.totalCents) blockers.push(`${order.supplierName}: faturamento abaixo do mínimo.`);
    const alternatives = rows.flatMap(({ item, winner, options, branches }) => {
      if (!winner) return [];
      const from = winner.supplier.supplier_id;
      const alternative = from === order.supplierId
        ? options.find(option => option.eligible && option.supplier.supplier_id !== from)
        : options.find(option => option.eligible && option.supplier.supplier_id === order.supplierId);
      if (!alternative) return [];
      const total = (price: number) => branches.reduce((sum, row) => sum + lineTotalCents(price, row.finalQuantity), 0);
      return [{ itemId: item.id, description: item.description, from: winner.supplier.supplier_name,
        to: alternative.supplier.supplier_name, toId: alternative.supplier.supplier_id, deltaCents: total(alternative.unitPrice) - total(winner.unitPrice) }];
    }).sort((a, b) => a.deltaCents - b.deltaCents).slice(0, 5);
    return { ...order, shortfallCents: order.minimumCents - order.totalCents, alternatives };
  });
  return { rows, orders: orderList, minimums, blockers };
}
