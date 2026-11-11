import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { buildQuotationRound, normalizeQuotationSupplier, quotationObject } from '@/lib/purchase-quotation-supplier';
import type { QuotationDraft } from '@/lib/purchase-quotation-import';
import { hashQuotationToken, inviteColumns, inviteTable, isQuotationUuid, newQuotationToken, quoteError, quoteJson, readQuotationJson, requireQuotationBuyer, roundTable, supplierColumns, supplierTable } from '@/lib/purchase-quotation-server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const auth = await requireQuotationBuyer(request);
    if (!auth.ok) return auth.response;
    const db = getSupabaseAdmin();
    const params = new URL(request.url).searchParams;
    const roundId = params.get('roundId');
    if (roundId !== null && !isQuotationUuid(roundId)) return quoteError('Cotação inválida.', 400);
    const readInvites = async () => {
      if (!roundId) return [];
      const result = await db.from(inviteTable).select(inviteColumns).eq('user_id', auth.userId)
        .eq('round_id', roundId).is('round.deleted_at', null).order('created_at', { ascending: false }).limit(1000);
      if (result.error) throw result.error;
      return result.data;
    };
    const [suppliers, invites] = await Promise.all([
      db.from(supplierTable).select(supplierColumns).eq('user_id', auth.userId).order('name').limit(1000),
      readInvites(),
    ]);
    if (suppliers.error) return quoteError('Não foi possível carregar fornecedores e convites.', 500);
    return quoteJson({ suppliers: suppliers.data, invites });
  } catch {
    return quoteError('Não foi possível carregar fornecedores e convites.', 500);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireQuotationBuyer(request);
    if (!auth.ok) return auth.response;
    let body: Record<string, unknown>;
    try { body = quotationObject(await readQuotationJson(request, 8192)); }
    catch (error) { return quoteError((error as Error).message, 400); }
    const owner = auth.userId;
    const db = getSupabaseAdmin();

    if (body.action === 'supplier') {
      let supplier;
      try { supplier = normalizeQuotationSupplier(body.supplier); }
      catch (error) { return quoteError((error as Error).message, 400); }
      if (body.id !== undefined && !isQuotationUuid(body.id)) return quoteError('Fornecedor inválido.', 400);
      const write = isQuotationUuid(body.id)
        ? db.from(supplierTable).update(supplier).eq('user_id', owner).eq('id', body.id)
        : db.from(supplierTable).insert({ ...supplier, user_id: owner });
      const result = await write.select(supplierColumns).maybeSingle();
      if (result.error?.code === '23505') return quoteError('Já existe um fornecedor com esse CNPJ.', 409);
      if (result.error) return quoteError('Não foi possível salvar o fornecedor.', 500);
      if (!result.data) return quoteError('Fornecedor não encontrado.', 404);
      return quoteJson({ supplier: result.data });
    }

    if (body.action === 'proposal' || body.action === 'revoke') {
      if (!isQuotationUuid(body.id)) return quoteError('Convite inválido.', 400);
      if (body.action === 'revoke') {
        const result = await db.from(inviteTable).update({ revoked_at: new Date().toISOString() })
          .eq('user_id', owner).eq('id', body.id).is('submitted_at', null).is('revoked_at', null).select('id').maybeSingle();
        if (result.error) return quoteError('Não foi possível revogar o convite.', 500);
        return result.data ? quoteJson({ ok: true }) : quoteError('Convite indisponível para revogação.', 409);
      }
      const result = await db.from(inviteTable).select('supplier_name,proposal,submitted_at,round:purchase_quotation_rounds!inner(supplier_items)')
        .eq('user_id', owner).eq('id', body.id).is('round.deleted_at', null).maybeSingle();
      if (result.error) return quoteError('Não foi possível consultar a proposta.', 500);
      return result.data?.submitted_at ? quoteJson(result.data) : quoteError('Não há proposta enviada para esse convite.', 404);
    }

    if (body.action !== 'invite' || !isQuotationUuid(body.supplierId) || !isQuotationUuid(body.roundId)
        || typeof body.expiresAt !== 'string') return quoteError('Informe um fornecedor, rascunho salvo e prazo válido.', 400);
    const expiry = new Date(body.expiresAt);
    const now = Date.now();
    if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= now || expiry.getTime() > now + 90 * 86400000) {
      return quoteError('Informe um prazo futuro de até 90 dias.', 400);
    }
    const supplier = await db.from(supplierTable).select(supplierColumns).eq('user_id', owner).eq('id', body.supplierId).maybeSingle();
    if (supplier.error) return quoteError('Não foi possível preparar o convite.', 500);
    if (!supplier.data) return quoteError('Fornecedor não encontrado.', 404);
    const round = await db.from(roundTable).select('id,title,draft_revision,draft_version,published_at').eq('user_id', owner)
      .eq('id', body.roundId).is('deleted_at', null).maybeSingle();
    if (round.error) return quoteError('Não foi possível localizar a cotação.', 500);
    if (!round.data) return quoteError('Cotação não encontrada.', 404);
    const { id, title, draft_revision, draft_version, published_at } = round.data;
    const identity = { id, title, draft_revision };
    const token = newQuotationToken();
    const values = { token_hash: hashQuotationToken(token), expires_at: expiry.toISOString(), revoked_at: null };
    const invite = {
      ...values, supplier_id: supplier.data.id, supplier_name: supplier.data.name,
      minimum_order: supplier.data.minimum_order, default_payment_days: supplier.data.payment_days,
    };
    if (!published_at) {
      if (body.draftVersion !== draft_version) return quoteError('O rascunho mudou. Abra a cotação novamente antes de gerar os links.', 409);
      const saved = await db.from(roundTable).select('draft').eq('id', id).eq('user_id', owner)
        .eq('draft_version', draft_version).is('published_at', null).is('deleted_at', null).maybeSingle();
      if (saved.error) return quoteError('Não foi possível preparar o convite.', 500);
      if (!saved.data) return quoteError('O rascunho mudou. Abra a cotação novamente.', 409);
      let snapshot;
      try { snapshot = buildQuotationRound(saved.data.draft as QuotationDraft); }
      catch (error) { return quoteError((error as Error).message, 400); }
      const published = await db.rpc('publish_purchase_quotation_workspace', {
        p_id: id, p_owner: owner, p_version: draft_version,
        p_buyer_items: snapshot.buyerItems, p_supplier_items: snapshot.supplierItems, p_invite: invite,
      });
      if (published.error) return quoteError('Não foi possível gerar o primeiro convite.', 500);
      if (!published.data) return quoteError('O rascunho mudou. Abra a cotação novamente.', 409);
      return quoteJson({ token, round: identity });
    }
    if (body.draftVersion !== undefined && body.draftVersion !== draft_version) {
      return quoteError('O rascunho mudou. Abra a cotação novamente.', 409);
    }
    const result = await db.from(inviteTable).insert({
      ...invite, user_id: owner, round_id: id,
    }).select('id').single();
    if (result.error?.code === '23505') {
      if (body.replace !== true) return quoteError('Já existe um convite para esse fornecedor nesta versão. Use Gerar novo link para substituir o anterior.', 409);
      const rotated = await db.from(inviteTable).update(values).eq('user_id', owner).eq('round_id', id)
        .eq('supplier_id', supplier.data.id).is('submitted_at', null).select('id').maybeSingle();
      if (rotated.error?.code === '23514') return quoteError('Esta cotação já está fechada.', 409);
      if (rotated.error) return quoteError('Não foi possível substituir o link.', 500);
      if (!rotated.data) return quoteError('O fornecedor já enviou a proposta. O convite não pode ser substituído.', 409);
    } else if (result.error) {
      if (result.error.code === '23514') return quoteError('Esta cotação já está fechada.', 409);
      return quoteError('Não foi possível gerar o convite.', 500);
    }
    return quoteJson({ token, round: identity });
  } catch {
    return quoteError('Não foi possível concluir a operação.', 500);
  }
}
