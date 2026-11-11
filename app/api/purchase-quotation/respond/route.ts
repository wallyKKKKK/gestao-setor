import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { hashQuotationToken, inviteTable, quoteError, quoteJson, readQuotationJson } from '@/lib/purchase-quotation-server';
import { normalizeSupplierProposal, quotationObject, type SupplierItem, type SupplierProposal } from '@/lib/purchase-quotation-supplier';

export const runtime = 'nodejs';

type PortalInvite = {
  id: string; supplier_name: string; default_payment_days: number; expires_at: string; submitted_at: string | null;
  revision: number; proposal: SupplierProposal | null; round: { supplier_items: SupplierItem[] };
};

async function findInvite(request: Request) {
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return null;
  const hash = hashQuotationToken(token);
  const db = getSupabaseAdmin();
  const result = await db.from(inviteTable).select('id,supplier_name,default_payment_days,expires_at,submitted_at,revision,proposal,round:purchase_quotation_rounds!inner(supplier_items)')
    .eq('token_hash', hash).is('round.deleted_at', null).is('revoked_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (result.error) throw result.error;
  return result.data ? { db, hash, invite: result.data as unknown as PortalInvite } : null;
}

const invalidLink = () => quoteError('Este link está inválido, expirado ou foi substituído. Peça um novo ao comprador.', 404);

export async function GET(request: Request) {
  try {
    const result = await findInvite(request);
    if (!result) return invalidLink();
    const { invite } = result;
    return quoteJson({
      supplier: invite.supplier_name, expiresAt: invite.expires_at,
      defaultPaymentDays: invite.default_payment_days, submittedAt: invite.submitted_at,
      revision: invite.revision, proposal: invite.proposal,
      items: invite.round.supplier_items.map(({ id, code, ean, description, quantity }) => ({ id, code, ean, description, quantity })),
    });
  } catch {
    return quoteError('Não foi possível abrir a cotação.', 500);
  }
}

export async function POST(request: Request) {
  try {
    const result = await findInvite(request);
    if (!result) return invalidLink();
    const { db, hash, invite } = result;
    if (invite.submitted_at) return quoteError('Esta proposta já foi enviada.', 409);
    let body, proposal;
    try {
      body = quotationObject(await readQuotationJson(request, 1500000));
      if (body.action !== 'save' && body.action !== 'submit') return quoteError('Ação inválida.', 400);
      proposal = normalizeSupplierProposal(body.proposal, invite.round.supplier_items, body.action === 'save');
    } catch (error) { return quoteError((error as Error).message, 400); }
    if (body.revision !== invite.revision) return quoteError('A proposta mudou em outra aba. Recarregue antes de tentar novamente.', 409);
    const now = new Date().toISOString();
    const write = await db.from(inviteTable).update({
      proposal, revision: invite.revision + 1, submitted_at: body.action === 'submit' ? now : null,
    }).eq('id', invite.id).eq('token_hash', hash).eq('revision', invite.revision)
      .is('submitted_at', null).is('revoked_at', null).gt('expires_at', now).select('revision,submitted_at').maybeSingle();
    if (write.error?.code === '23514') return quoteError('O convite expirou ou a cotação já foi fechada.', 409);
    if (write.error) return quoteError('Não foi possível salvar sua proposta.', 500);
    if (!write.data) return quoteError('O convite expirou ou a proposta mudou. Recarregue o link.', 409);
    return quoteJson({ revision: write.data.revision, submittedAt: write.data.submitted_at });
  } catch {
    return quoteError('Não foi possível salvar sua proposta.', 500);
  }
}
