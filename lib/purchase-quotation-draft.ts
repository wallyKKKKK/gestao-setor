import { supabase } from '@/lib/supabase';
import { getAuthHeaders } from '@/lib/auth-headers';
import type { QuotationDraft } from '@/lib/purchase-quotation-import';

export type QuotationDraftSession = {
  id: string;
  draft: QuotationDraft;
  revision: number;
  dirty: boolean;
};

export const emptyQuotationDraft: QuotationDraft = { links: {}, chosenCosts: {} };
const conflictMessage = 'Este rascunho mudou em outra aba ou dispositivo. Carregue a versão salva antes de sobrescrever.';

export class QuotationDraftConflict extends Error {
  constructor() { super(conflictMessage); }
}

async function workspaceRequest(method: 'POST' | 'DELETE', id?: string) {
  const response = await fetch('/api/purchase-quotation/workspaces' + (id ? `?id=${encodeURIComponent(id)}` : ''), {
    method, headers: await getAuthHeaders(), cache: 'no-store',
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? 'Não foi possível acessar a cotação.');
  return data;
}

export async function createQuotationWorkspace(): Promise<QuotationDraftSession> {
  const { id } = await workspaceRequest('POST');
  return { id, draft: emptyQuotationDraft, revision: 0, dirty: false };
}

export async function deleteQuotationWorkspace(id: string) {
  await workspaceRequest('DELETE', id);
}

export async function loadQuotationDraft(id: string): Promise<QuotationDraftSession> {
  const { data, error } = await supabase.rpc('read_purchase_quotation_workspace', { p_id: id }).maybeSingle();
  if (error) throw new Error('Não foi possível carregar o rascunho. Tente novamente.');
  if (!data) throw new Error('Este rascunho não está mais disponível. Atualize a lista de cotações.');
  const row = data as { draft: QuotationDraft; draft_version: number };
  return { id, draft: row.draft, revision: row.draft_version, dirty: false };
}

export async function saveQuotationDraft({ id, draft, revision }: QuotationDraftSession) {
  const { data, error } = await supabase.rpc('save_purchase_quotation_workspace', { p_id: id, p_version: revision, p_draft: draft });
  if (!error && data === null) throw new QuotationDraftConflict();
  if (error?.code === '23514' && error.message.includes('quotation_workspace_draft_size')) {
    throw new Error('Rascunho grande demais. Importe uma planilha de custos com menos registros.');
  }
  if (error || !data) throw new Error('Não foi possível salvar o rascunho. As alterações continuam nesta aba.');
  return data as number;
}
