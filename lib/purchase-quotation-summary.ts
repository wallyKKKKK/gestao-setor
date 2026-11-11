import type { QuotationOrder } from '@/lib/purchase-quotation-settlement';

export const quotationTimeZone = 'America/Fortaleza';
const monthFormat = new Intl.DateTimeFormat('en', { timeZone: quotationTimeZone, year: 'numeric', month: 'numeric' });

export function quotationSummaryMonths(now: Date) {
  const parts = monthFormat.formatToParts(now);
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value) - 1;
  // Fortaleza is UTC-03:00 for the periods covered by the quotation system.
  const start = (index: number) => new Date(Date.UTC(year, index, 1, 3)).toISOString();
  return [0, 1, 2].map(offset => ({ start: start(month - offset), end: start(month - offset + 1) }));
}

export type ClosedQuotation = { closed_at: string; orders: QuotationOrder[] };
export type QuotationMonthSummary = {
  start: string;
  orders: number;
  suppliersWithOrders: number;
  orderTotalCents: number;
  referenceTotalCents: number;
  comparablePaidCents: number;
  lines: number;
  comparableLines: number;
};

export type PurchaseQuotationSummary = {
  ongoing: number;
  closed: number;
  pendingInvites: number;
  suppliers: number;
  createdThisMonth: number;
  responsesThisMonth: number;
  months: QuotationMonthSummary[];
};

export function summarizeQuotationMonths(months: ReturnType<typeof quotationSummaryMonths>, settlements: ClosedQuotation[]): QuotationMonthSummary[] {
  return months.map(({ start, end }) => {
    const summary: QuotationMonthSummary = {
      start, orders: 0, suppliersWithOrders: 0, orderTotalCents: 0,
      referenceTotalCents: 0, comparablePaidCents: 0, lines: 0, comparableLines: 0,
    };
    const suppliers = new Set<string>();
    const first = Date.parse(start);
    const last = Date.parse(end);
    for (const settlement of settlements) {
      const closed = Date.parse(settlement.closed_at);
      if (!(closed >= first && closed < last)) continue;
      for (const order of settlement.orders) {
        summary.orders++;
        suppliers.add(order.supplierId);
        summary.orderTotalCents += order.totalCents;
        for (const line of order.lines) {
          summary.lines++;
          if (!(line.referenceUnitCost && line.referenceUnitCost > 0 && line.unitsPerPackage && line.unitsPerPackage > 0)) continue;
          summary.comparableLines++;
          summary.referenceTotalCents += Math.round(line.referenceUnitCost * line.unitsPerPackage * line.quantity * 100);
          summary.comparablePaidCents += line.totalCents;
        }
      }
    }
    summary.suppliersWithOrders = suppliers.size;
    return summary;
  });
}
