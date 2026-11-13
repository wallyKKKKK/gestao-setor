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

export function expiringBalancesByDeadline(items: ExpiringInventoryItem[]) {
  const groups = new Map<string, ExpiringInventoryItem[]>();
  const balances = new Map<ExpiringInventoryItem, number>();
  for (const item of items) {
    const key = JSON.stringify([item.branch_code, item.ean]);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.days_to_expire - b.days_to_expire);
    let balance = 0;
    for (let start = 0; start < group.length;) {
      let end = start;
      // Lots with the same deadline compete for the same projected sales.
      do {
        balance += Math.max(0, Number(group[end++].balance_quantity) || 0);
      } while (end < group.length && group[end].days_to_expire === group[start].days_to_expire);
      for (; start < end; start++) balances.set(group[start], balance);
    }
  }
  return balances;
}

const quantityLabel = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

export function expiringRuleType(rule: Pick<ExpiringDiscountRule, 'rule_type' | 'scope_type'>) {
  return rule.rule_type ?? (rule.scope_type === 'validity' ? 'general' : 'specific');
}

export type ExpiringRuleTrace = { rule: ExpiringDiscountRule; reason: string }[];

export function expiringDemandProjection(item: ExpiringInventoryItem, balance: number) {
  const monthly = item.monthly_average;
  if (monthly == null || !Number.isFinite(Number(monthly)) || Number(monthly) < 0) return null;
  return { monthly: Number(monthly), projected: Number(monthly) * item.days_to_expire / 30, balance };
}

export function classifyExpiringItem(item: ExpiringInventoryItem, sortedRules: ExpiringDiscountRule[], basePrice: number, balance = Number(item.balance_quantity), trace?: ExpiringRuleTrace) {
  const matchingRules = sortedRules.filter(rule => rule.scope_type === 'validity' ||
    matchesExpiringRuleTarget(rule, item[scopeFields[rule.scope_type]] || ''));
  const specificRules = matchingRules.filter(rule => expiringRuleType(rule) === 'specific');
  const candidates = specificRules.length ? specificRules : matchingRules;
  const days = item.days_to_expire;
  let exclusionReason = specificRules.length
    ? `${days} dias: fora da faixa específica. O grupo não entra nas regras gerais.`
    : `${days} dias: Nenhuma regra ativa para o alvo e o prazo`;
  let rejectedRule: ExpiringDiscountRule | null = null;
  let demandNote: string | null = null;
  const inRange = (rule: ExpiringDiscountRule) => days >= rule.min_days_to_expire && days <= rule.max_days_to_expire;
  const recordRemaining = (reason: string) => {
    if (!trace) return;
    for (const rule of matchingRules) {
      if (trace.some(entry => entry.rule === rule)) continue;
      trace.push({ rule, reason: !candidates.includes(rule) ? 'Bloqueada pela regra específica' : !inRange(rule) ? 'Fora da faixa de dias' : reason });
    }
  };
  for (const rule of candidates) {
    if (!inRange(rule)) {
      trace?.push({ rule, reason: 'Fora da faixa de dias' });
      continue;
    }

    const demand = rule.skip_if_demand_covers_balance ? expiringDemandProjection(item, balance) : null;
    const ruleDemandNote = rule.skip_if_demand_covers_balance && !demand ? 'Demanda mensal não informada' : null;
    if (demand && balance > 0 && demand.projected >= balance) {
      exclusionReason = `Venda estimada cobre o saldo antes do vencimento: ${quantityLabel.format(demand.projected)} un. para ${quantityLabel.format(balance)} un. de saldo`;
      trace?.push({ rule, reason: exclusionReason });
      recordRemaining('Não avaliada: a sub-regra de demanda dispensou a oferta');
      return { item, rule: null, basePrice, price: 0, discount: 0, line: null, exclusionReason, rejectedRule: rule, demandNote: ruleDemandNote };
    }

    const value = Number(rule.discount_value);
    const usesCost = rule.discount_type === 'half_cost_price' || rule.discount_type === 'cost_percent_price';
    const usesSale = rule.discount_type === 'sale_percent_price';
    const importedBase = Number(usesCost ? item.cost_price : item.sale_price);
    const erpCalculated = isMarkupOffer(rule.discount_type) || isStructuredOffer(rule.discount_type);
    const rawPrice = erpCalculated ? 0 : usesCost || usesSale
      ? importedBase * (rule.discount_type === 'half_cost_price' ? 0.5 : value / 100)
      : rule.discount_type === 'fixed_price' ? value : basePrice * (1 - value / 100);
    const precision = rule.discount_type === 'fixed_price' || (rule.discount_type === 'cost_percent_price' && value === 100) ? 10000 : 100;
    const price = Math.round((rawPrice + Number.EPSILON) * precision) / precision;
    const percentage = rule.discount_type === 'percent';
    const discount = percentage ? value : !erpCalculated && basePrice > 0 ? Math.max(0, (1 - price / basePrice) * 100) : 0;
    const line = formatA7OfferLine(item.ean, rule.discount_type, erpCalculated || percentage ? value : price, rule.offer_config);
    if (line && (!percentage || value <= 100)) {
      trace?.push({ rule, reason: 'Regra aplicada' });
      recordRemaining('Mesmo alvo e prazo, mas uma regra anterior foi aplicada');
      return { item, rule, basePrice, price, discount, line, exclusionReason: null, rejectedRule: null, demandNote: ruleDemandNote };
    }
    const invalidReason = usesCost && !(importedBase > 0) ? 'Custo ausente ou inválido no arquivo'
      : usesSale && !(importedBase > 0) ? 'Preço de venda ausente ou inválido no arquivo'
      : 'Regra não gerou um valor válido para exportação';
    trace?.push({ rule, reason: invalidReason });
    if (!rejectedRule) {
      rejectedRule = rule;
      demandNote = ruleDemandNote;
      exclusionReason = invalidReason;
    }
  }
  recordRemaining('Não aplicada');
  return { item, rule: null, basePrice, price: 0, discount: 0, line: null, exclusionReason, rejectedRule: rejectedRule ?? specificRules[0] ?? null, demandNote };
}

type ExportRow = ReturnType<typeof classifyExpiringItem>;

export function groupExpiringOffers(rows: ExportRow[], fileKey: (row: ExportRow) => string) {
  const groups = new Map<string, Map<string, ExportRow & { warnings: string[] }>>();
  for (const row of rows) {
    if (!row.line) continue;
    const key = JSON.stringify([fileKey(row), row.item.ean.trim()]);
    const offers = groups.get(key) ?? new Map();
    const existing = offers.get(row.line);
    const warnings = expiringPriceWarnings(row);
    if (!existing) offers.set(row.line, { ...row, warnings });
    else existing.warnings = [...new Set([...existing.warnings, ...warnings])];
    groups.set(key, offers);
  }
  return [...groups].map(([key, offers]) => ({ key, offers: [...offers.values()] }));
}

export function expiringPriceWarnings(row: ExportRow) {
  if (!row.rule) return [];
  const type = row.rule.discount_type;
  if (isMarkupOffer(type) || isStructuredOffer(type) || (type === 'percent' && !(row.basePrice > 0))) {
    return ['Preço final a conferir no ERP'];
  }
  const price = type === 'percent' ? row.basePrice * (1 - row.discount / 100) : row.price;
  const comparablePrice = type === 'percent' ? Math.round(price * 100) * 100 : Math.round(price * 10000);
  const cost = Number(row.item.cost_price);
  const sale = Number(row.item.sale_price) || row.basePrice;
  return [
    ...(cost > 0 && comparablePrice < Math.round(cost * 10000) ? ['Abaixo do custo importado'] : []),
    ...(sale > 0 && comparablePrice >= Math.round(sale * 10000) ? ['Não reduz o preço de venda'] : []),
  ];
}

const fortalezaDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Fortaleza' });

export function expiringDateReview(item: ExpiringInventoryItem, now = new Date()) {
  const today = fortalezaDate.format(now);
  const expiration = item.expiration_date;
  const parsed = expiration ? Date.parse(`${expiration}T00:00:00Z`) : NaN;
  const validDate = Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === expiration;
  const actualDays = validDate ? (parsed - Date.parse(`${today}T00:00:00Z`)) / 86400000 : null;
  const imported = Date.parse(item.imported_at || '');
  return {
    actualDays,
    mismatch: actualDays !== null && actualDays !== item.days_to_expire,
    stale: Number.isFinite(imported) && fortalezaDate.format(imported) < today,
  };
}
