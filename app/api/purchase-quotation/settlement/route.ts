import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { inviteTable, isQuotationUuid, quoteError, quoteJson, readQuotationJson, requireQuotationBuyer, roundTable, supplierTable } from '@/lib/purchase-quotation-server';
import { assessQuotation, normalizeSettlement, type SettlementRound, type SettlementInvite, type SettlementRecord } from '@/lib/purchase-quotation-settlement';
import { quotationObject } from '@/lib/purchase-quotation-supplier';
import { quotationInviteProgress, quotationListPageSize } from '@/lib/purchase-quotation-workflow';

export const runtime = 'nodejs';
const table = 'purchase_quotation_settlements';
const columns = 'revision,decisions,orders,closed_at';

async function loadOrderLabels(orders: NonNullable<SettlementRecord['orders']>, owner: string) {
  const db = getSupabaseAdmin();
  const supplierIds = [...new Set(orders.map(order => order.supplierId))];
  const branchIds = [...new Set(orders.flatMap(order => order.lines.flatMap(line => {
    const cnpj = line.branchCnpj.replace(/\D/g, '');
    return cnpj.length === 14 ? [cnpj, cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')] : [];
  })))];
  const contacts: Array<{ id: string; contact: string }> = [];
  const branches: Array<{ cnpj: string; name: string }> = [];
  for (let offset = 0; offset < supplierIds.length; offset += 100) {
    const { data, error } = await db.from(supplierTable).select('id,contact').eq('user_id', owner).in('id', supplierIds.slice(offset, offset + 100));
    if (!error && data) contacts.push(...data);
  }
  for (let offset = 0; offset < branchIds.length; offset += 100) {
    const { data, error } = await db.from('pricing_branches').select('cnpj,name').in('cnpj', branchIds.slice(offset, offset + 100)).order('is_active', { ascending: false }).order('code');
    if (!error && data) branches.push(...data);
  }
  return { contacts, branches };
}

async function load(id: string, owner: string) {
  const db = getSupabaseAdmin();
  const [round, invites, settlement] = await Promise.all([
    db.from(roundTable).select('id,title,draft_revision,buyer_items,supplier_items').eq('id', id).eq('user_id', owner)
      .is('deleted_at', null).not('published_at', 'is', null).maybeSingle(),
    db.from(inviteTable).select('supplier_id,supplier_name,minimum_order,expires_at,revoked_at,submitted_at,proposal')
      .eq('round_id', id).eq('user_id', owner).order('supplier_name').limit(1000),
    db.from(table).select(columns).eq('round_id', id).eq('user_id', owner).maybeSingle(),
  ]);
  if (round.error || invites.error || settlement.error) throw new Error('load');
  if (!round.data) return null;
  if (invites.data.length === 1000) throw new Error('invite limit');
  return { round: round.data as SettlementRound, invites: (invites.data as SettlementInvite[]).map(invite =>
    invite.submitted_at ? invite : { ...invite, proposal: null }), settlement: settlement.data as SettlementRecord | null };
}

export async function GET(request: Request) {
  try {
    const auth = await requireQuotationBuyer(request);
    if (!auth.ok) return auth.response;
    const params = new URL(request.url).searchParams;
    const id = params.get('roundId');
    if (id === null) {
      const page = Number(params.get('page') ?? '0');
      if (!Number.isSafeInteger(page) || page < 0 || page > 10000) return quoteError('Página inválida.', 400);
      const db = getSupabaseAdmin();
      const owner = auth.userId;
      const start = page * quotationListPageSize;
      const rounds = await db.from(roundTable).select('id,title,draft_revision,created_at,published_at', { count: 'exact' })
        .eq('user_id', owner).is('deleted_at', null).order('draft_revision', { ascending: false }).range(start, start + quotationListPageSize - 1);
      if (rounds.error) throw new Error('rounds');
      if (!rounds.data.length) return quoteJson({ rounds: [], total: rounds.count ?? 0 });
      const ids = rounds.data.map(round => round.id);
      const readInvites = async () => {
        type Invite = { round_id: string; expires_at: string; submitted_at: string | null; revoked_at: string | null };
        const byRound = new Map<string, Invite[]>();
        for (let offset = 0;; offset += 500) {
          const result = await db.from(inviteTable).select('round_id,expires_at,submitted_at,revoked_at')
            .eq('user_id', owner).in('round_id', ids).order('id').range(offset, offset + 499);
          if (result.error) throw result.error;
          for (const invite of result.data as Invite[]) {
            const list = byRound.get(invite.round_id) ?? [];
            list.push(invite);
            byRound.set(invite.round_id, list);
          }
          if (result.data.length < 500) return byRound;
        }
      };
      const [invites, settlements] = await Promise.all([
        readInvites(),
        db.from(table).select('round_id,closed_at').eq('user_id', owner).in('round_id', ids),
      ]);
      if (settlements.error) throw settlements.error;
      const closed = new Map(settlements.data.map(row => [row.round_id, row.closed_at as string | null]));
      const now = Date.now();
      return quoteJson({
        rounds: rounds.data.map(round => ({ ...round, closedAt: closed.get(round.id) ?? null, ...quotationInviteProgress(invites.get(round.id) ?? [], now) })),
        total: rounds.count ?? 0,
      });
    }
    if (!isQuotationUuid(id)) return quoteError('Cotação inválida.', 400);
    const data = await load(id, auth.userId);
    if (!data) return quoteError('Cotação não encontrada.', 404);
    return quoteJson(data.settlement?.closed_at && data.settlement.orders
      ? { ...data, orderLabels: await loadOrderLabels(data.settlement.orders, auth.userId) }
      : data);
  } catch {
    return quoteError('Não foi possível carregar a apuração.', 500);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireQuotationBuyer(request);
    if (!auth.ok) return auth.response;
    let body;
    try { body = quotationObject(await readQuotationJson(request, 1500000)); }
    catch (error) { return quoteError((error as Error).message, 400); }
    const { roundId, revision, action } = body;
    if (!isQuotationUuid(roundId) || (action !== 'save' && action !== 'close')
      || (revision !== null && (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1))) {
      return quoteError('Versão ou ação inválida.', 400);
    }
    const data = await load(roundId, auth.userId);
    if (!data) return quoteError('Cotação não encontrada.', 404);
    if (data.settlement?.closed_at) return quoteError('Esta cotação já está fechada.', 409);
    if ((data.settlement?.revision ?? null) !== revision) return quoteError('A apuração mudou. Recarregue antes de salvar.', 409);
    let decisions;
    try { decisions = normalizeSettlement(body.decisions, data.round, data.invites); }
    catch (error) { return quoteError((error as Error).message, 400); }
    const close = action === 'close';
    let orders = null;
    const submitted = data.invites.filter(invite => invite.submitted_at && !invite.revoked_at).map(invite => invite.supplier_id).sort();
    if (close) {
      const now = Date.now();
      if (data.invites.some(invite => !invite.submitted_at && !invite.revoked_at && Date.parse(invite.expires_at) > now)) {
        return quoteError('Ainda há convites aguardando resposta. Aguarde o prazo ou revogue-os para fechar.', 409);
      }
      if (!Array.isArray(body.submittedSuppliers) || JSON.stringify([...body.submittedSuppliers].sort()) !== JSON.stringify(submitted)) {
        return quoteError('Chegaram novas propostas. Atualize a apuração e confira os vencedores antes de fechar.', 409);
      }
      const assessment = assessQuotation(data.round, data.invites, decisions);
      if (assessment.blockers.length) return quoteError(assessment.blockers[0], 422);
      if (!assessment.orders.length) return quoteError('Selecione ao menos um item para comprar.', 422);
      orders = assessment.orders;
    }
    const orderLabels = orders ? await loadOrderLabels(orders, auth.userId) : undefined;
    const db = getSupabaseAdmin();
    const values = {
      decisions, orders, closed_at: close ? new Date().toISOString() : null, revision: (revision ?? 0) + 1,
      submitted_suppliers: close ? submitted : [],
    };
    const write = revision === null
      ? db.from(table).insert({ ...values, round_id: roundId, user_id: auth.userId })
      : db.from(table).update(values).eq('round_id', roundId).eq('user_id', auth.userId).eq('revision', revision).is('closed_at', null);
    const result = await write.select(columns).maybeSingle();
    if (result.error?.code === '23505' || result.error?.code === '23514' || (!result.error && !result.data)) {
      return quoteError('A cotação mudou enquanto você salvava. Recarregue e confira os convites e a apuração.', 409);
    }
    if (result.error) throw new Error('save');
    return quoteJson({ settlement: result.data, orderLabels });
  } catch {
    return quoteError('Não foi possível salvar a apuração.', 500);
  }
}
