export type QuotationRoundIdentity = { id: string; title: string; draft_revision: number };
export type QuotationRoundListItem = QuotationRoundIdentity & {
  created_at: string;
  published_at: string | null;
  closedAt: string | null;
  deadline: string | null;
  participants: number;
  responses: number;
  pending: number;
};
export type QuotationWorkflowStage = 'tracking' | 'settlement' | 'orders';
export const quotationListPageSize = 20;

export function quotationNextStage(round: Pick<QuotationRoundListItem, 'closedAt' | 'pending' | 'responses' | 'published_at'>): QuotationWorkflowStage | 'products' {
  if (round.closedAt) return 'orders';
  if (round.published_at === null) return 'products';
  return round.responses > 0 && round.pending === 0 ? 'settlement' : 'tracking';
}

export function quotationInviteProgress(invites: Array<{ expires_at: string; revoked_at: string | null; submitted_at: string | null }>, now: number) {
  let deadline: string | null = null;
  let participants = 0;
  let responses = 0;
  let pending = 0;
  for (const invite of invites) {
    if (invite.revoked_at) continue;
    participants++;
    if (invite.submitted_at) responses++;
    else if (Date.parse(invite.expires_at) > now) pending++;
    if (!deadline || Date.parse(invite.expires_at) > Date.parse(deadline)) deadline = invite.expires_at;
  }
  return { deadline, participants, responses, pending };
}
