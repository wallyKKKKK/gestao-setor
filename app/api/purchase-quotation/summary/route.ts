import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { inviteTable, quoteError, quoteJson, requireQuotationBuyer, roundTable, supplierTable } from '@/lib/purchase-quotation-server';
import { quotationSummaryMonths, summarizeQuotationMonths, type ClosedQuotation, type PurchaseQuotationSummary } from '@/lib/purchase-quotation-summary';

export const runtime = 'nodejs';
const settlementsTable = 'purchase_quotation_settlements';
const pageSize = 15;
const visibleRound = 'round:purchase_quotation_rounds!inner()';

export async function GET(request: Request) {
  try {
    const auth = await requireQuotationBuyer(request);
    if (!auth.ok) return auth.response;
    const db = getSupabaseAdmin();
    const owner = auth.userId;
    const now = new Date();
    const asOf = now.toISOString();
    const months = quotationSummaryMonths(now);
    const thisMonth = months[0].start;
    const count = { count: 'exact', head: true } as const;

    const readClosed = async () => {
      const settlements: ClosedQuotation[] = [];
      let cursor: string | null = null;
      for (;;) {
        const query = db.from(settlementsTable).select(`round_id,closed_at,orders,${visibleRound}`).eq('user_id', owner).is('round.deleted_at', null)
          .gte('closed_at', months[2].start).lte('closed_at', asOf).order('round_id').limit(pageSize);
        if (cursor) query.gt('round_id', cursor);
        const { data, error } = await query;
        if (error) throw error;
        settlements.push(...data as ClosedQuotation[]);
        if (data.length < pageSize) return settlements;
        cursor = data[data.length - 1].round_id;
      }
    };
    const [counts, settlements] = await Promise.all([
      Promise.all([
        db.from(roundTable).select('id', count).eq('user_id', owner).is('deleted_at', null).lte('created_at', asOf),
        db.from(settlementsTable).select(`round_id,${visibleRound}`, count).eq('user_id', owner).is('round.deleted_at', null).lte('closed_at', asOf),
        db.from(inviteTable).select(`id,${visibleRound}`, count).eq('user_id', owner).is('round.deleted_at', null).lte('created_at', asOf)
          .is('revoked_at', null).is('submitted_at', null).gt('expires_at', asOf),
        db.from(supplierTable).select('id', count).eq('user_id', owner),
        db.from(roundTable).select('id', count).eq('user_id', owner).is('deleted_at', null).gte('published_at', thisMonth).lte('published_at', asOf),
        db.from(inviteTable).select(`id,${visibleRound}`, count).eq('user_id', owner).is('round.deleted_at', null).is('revoked_at', null)
          .gte('submitted_at', thisMonth).lte('submitted_at', asOf),
      ]),
      readClosed(),
    ]);
    const [rounds, closed, pendingInvites, suppliers, createdThisMonth, responsesThisMonth] = counts.map(result => {
      if (result.error || result.count === null) throw new Error('Failed to count quotation activity');
      return result.count;
    });
    return quoteJson({
      ongoing: rounds - closed, closed, pendingInvites, suppliers, createdThisMonth, responsesThisMonth,
      months: summarizeQuotationMonths(months, settlements),
    } satisfies PurchaseQuotationSummary);
  } catch {
    return quoteError('Não foi possível carregar o resumo das cotações.', 500);
  }
}
