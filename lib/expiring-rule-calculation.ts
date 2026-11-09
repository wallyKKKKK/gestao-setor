import type { ExpiringDiscountRule, ExpiringInventoryItem } from './types';
import { matchesExpiringRuleTarget } from './expiring-rule-targets';
import { formatA7OfferLine, isMarkupOffer, isStructuredOffer } from './expiring-a7-offer';

const scopeFields = {
  product: 'ean',
  manufacturer: 'manufacturer',
  line: 'line',
  department: 'department',
  category: 'category',
  classification: 'classification_path',
} as const;
const scopeRank = { product: 0, manufacturer: 1, category: 2, department: 3, line: 4, classification: 5, validity: 9 };

export function sortExpiringRules(rules: ExpiringDiscountRule[]) {
  return rules.filter(rule => rule.is_active).sort((a, b) => a.priority - b.priority || scopeRank[a.scope_type] - scopeRank[b.scope_type]);
}

export function classifyExpiringItem(item: ExpiringInventoryItem, sortedRules: ExpiringDiscountRule[], basePrice: number) {
  let exclusionReason = 'Nenhuma regra ativa para o alvo e o prazo';
  let rejectedRule: ExpiringDiscountRule | null = null;
  for (const rule of sortedRules) {
    if (item.days_to_expire < rule.min_days_to_expire || item.days_to_expire > rule.max_days_to_expire) continue;
    if (rule.scope_type !== 'validity' && !matchesExpiringRuleTarget(rule, item[scopeFields[rule.scope_type]])) continue;

    const value = Number(rule.discount_value);
    const usesCost = rule.discount_type === 'half_cost_price' || rule.discount_type === 'cost_percent_price';
    const usesSale = rule.discount_type === 'sale_percent_price';
    const importedBase = Number(usesCost ? item.cost_price : item.sale_price);
    const erpCalculated = isMarkupOffer(rule.discount_type) || isStructuredOffer(rule.discount_type);
    const rawPrice = erpCalculated ? 0 : usesCost || usesSale
      ? importedBase * (rule.discount_type === 'half_cost_price' ? 0.5 : value / 100)
      : rule.discount_type === 'fixed_price' ? value : basePrice * (1 - value / 100);
    const precision = rule.discount_type === 'fixed_price' ? 10000 : 100;
    const price = Math.round((rawPrice + Number.EPSILON) * precision) / precision;
    const percentage = rule.discount_type === 'percent';
    const discount = percentage ? value : !erpCalculated && basePrice > 0 ? Math.max(0, (1 - price / basePrice) * 100) : 0;
    const line = formatA7OfferLine(item.ean, rule.discount_type, erpCalculated || percentage ? value : price, rule.offer_config);
    if (line && (!percentage || value <= 100)) {
      return { item, rule, basePrice, price, discount, line, exclusionReason: null, rejectedRule: null };
    }
    if (!rejectedRule) {
      rejectedRule = rule;
      exclusionReason = usesCost && !(importedBase > 0) ? 'Custo ausente ou inválido no arquivo'
        : usesSale && !(importedBase > 0) ? 'Preço de venda ausente ou inválido no arquivo'
        : 'Regra não gerou um valor válido para exportação';
    }
  }
  return { item, rule: null, basePrice, price: 0, discount: 0, line: null, exclusionReason, rejectedRule };
}
