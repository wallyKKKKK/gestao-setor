import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { isQuotationUuid, quoteError, quoteJson, requireQuotationBuyer, roundTable } from '@/lib/purchase-quotation-server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = await requireQuotationBuyer(request);
    if (!auth.ok) return auth.response;
    const { data, error } = await getSupabaseAdmin().rpc('create_purchase_quotation_workspace', { p_user_id: auth.userId });
    if (error?.code === 'P0001') {
      return quoteError('Você já tem 5 cotações ativas. Finalize ou exclua uma para criar outra.', 409);
    }
    if (error || !data) throw error;
    return quoteJson({ id: data }, 201);
  } catch {
    return quoteError('Não foi possível criar a cotação.', 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireQuotationBuyer(request);
    if (!auth.ok) return auth.response;
    const id = new URL(request.url).searchParams.get('id');
    if (!isQuotationUuid(id)) return quoteError('Cotação inválida.', 400);
    const { data, error } = await getSupabaseAdmin().from(roundTable)
      .update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('user_id', auth.userId)
      .is('deleted_at', null).select('id').maybeSingle();
    if (error) throw error;
    return data ? quoteJson({ ok: true }) : quoteError('Cotação não encontrada.', 404);
  } catch {
    return quoteError('Não foi possível excluir a cotação.', 500);
  }
}
