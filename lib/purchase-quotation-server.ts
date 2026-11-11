import { createHash, randomBytes } from 'node:crypto';
import { normalizePermissionSector } from '@/lib/permissions';
import { requireAuthenticatedProfile } from '@/lib/server-auth';

export const supplierTable = 'purchase_quotation_suppliers';
export const roundTable = 'purchase_quotation_rounds';
export const inviteTable = 'purchase_quotation_invites';
export const supplierColumns = 'id,cnpj,name,contact,email,whatsapp,coverage,minimum_order,payment_days';
export const inviteColumns = 'id,supplier_id,supplier_name,expires_at,revoked_at,submitted_at,revision,round:purchase_quotation_rounds!inner(title,draft_revision)';
export const quoteJson = (data: unknown, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
});
export const quoteError = (error: string, status: number) => quoteJson({ error }, status);
export const hashQuotationToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newQuotationToken = () => randomBytes(32).toString('base64url');
export const isQuotationUuid = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id);

export async function requireQuotationBuyer(request: Request) {
  const auth = await requireAuthenticatedProfile(request);
  if (!auth.ok) return auth;
  if (auth.profile.is_active !== true || auth.profile.account_status !== 'approved'
      || (auth.profile.role !== 'admin' && !normalizePermissionSector(auth.profile.sector || '').startsWith('compras'))) {
    return { ok: false as const, response: quoteError('Acesso exclusivo para Compras ou Administração.', 403) };
  }
  return auth;
}

export async function readQuotationJson(request: Request, limit: number) {
  if (!request.body || !request.headers.get('content-type')?.startsWith('application/json')) throw new Error('Envie os dados em JSON.');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error('O conteúdo enviado excede o limite.');
    }
    body += decoder.decode(part.value, { stream: true });
  }
  try { return JSON.parse(body + decoder.decode()) as unknown; }
  catch { throw new Error('Dados inválidos.'); }
}
