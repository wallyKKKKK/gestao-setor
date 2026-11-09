import type { ExpiringDiscountType, ExpiringOfferConfig } from './types';

export const expiringA7Kind: Record<ExpiringDiscountType, string> = {
  fixed_price: 'A', half_cost_price: 'A', cost_percent_price: 'A', sale_percent_price: 'A',
  percent: 'B', buy_pay: 'C', quantity_discount: 'D',
  cost_markup: 'E', average_cost_markup: 'F', reference_price_markup: 'G',
};

export const quantityOfferTypes = {
  A: '% Desconto', B: 'Preço oferta', C: 'Preço total', D: '% Markup sobre custo',
  E: '% Markup sobre preço referencial', F: '% Markup sobre custo médio',
  G: '% Desconto total (Scantech)', H: 'Desconto fixo (Scantech)',
};

const decimal = (value: number) => value.toFixed(4);
export const validOfferValue = (value: number) => Number.isFinite(value) && value >= 0.0001 && value <= 9999999999.9999;
const validQuantity = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
export const isStructuredOffer = (type: ExpiringDiscountType) => type === 'buy_pay' || type === 'quantity_discount';
export const isMarkupOffer = (type: ExpiringDiscountType) => ['cost_markup', 'average_cost_markup', 'reference_price_markup'].includes(type);

export function normalizeOfferConfig(type: ExpiringDiscountType, input: unknown): ExpiringOfferConfig | null {
  if (!input || typeof input !== 'object') return null;
  const { take, pay, quantityType, aboveQuantity, tiers } = input as ExpiringOfferConfig;
  if (type === 'buy_pay') {
    return validQuantity(take) && validQuantity(pay) && pay < take ? { take, pay } : null;
  }
  if (type !== 'quantity_discount' || !quantityType || !Object.hasOwn(quantityOfferTypes, quantityType)
      || (aboveQuantity !== 'A' && aboveQuantity !== 'B') || !Array.isArray(tiers) || tiers.length < 1 || tiers.length > 3) return null;
  if (!tiers.every((tier, index) => tier && validQuantity(tier.quantity) && typeof tier.value === 'number' && validOfferValue(tier.value)
      && (!(quantityType === 'A' || quantityType === 'G') || tier.value <= 100)
      && (!index || tier.quantity > tiers[index - 1].quantity))) return null;
  return { quantityType, aboveQuantity, tiers: tiers.map(({ quantity, value }) => ({ quantity, value: Number(decimal(value)) })) };
}

export function formatA7OfferLine(code: string, type: ExpiringDiscountType, value: number, config?: ExpiringOfferConfig | null) {
  const identifier = code.trim();
  const kind = expiringA7Kind[type];
  if (!kind || !identifier || /[|\r\n]/.test(identifier)) return null;
  const prefix = `${kind}|${identifier}|||`;
  if (isStructuredOffer(type)) {
    const offer = normalizeOfferConfig(type, config);
    if (!offer) return null;
    if (type === 'buy_pay') return `${prefix}${offer.take}|${offer.pay}`;
    return `${prefix}${offer.quantityType}|${offer.aboveQuantity}|${offer.tiers!.map(tier => `${tier.quantity};${decimal(tier.value)}`).join('|')}`;
  }
  return validOfferValue(value) ? prefix + decimal(value) : null;
}
