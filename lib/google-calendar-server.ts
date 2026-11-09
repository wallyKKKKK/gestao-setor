import { GoogleCalendarScopeRequiredError, getTokenExpiration, isGoogleReconnectRequiredError, refreshGoogleAccessToken, type GoogleCalendarConnection } from '@/lib/google-calendar';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const pendingTokens = new Map<string, Promise<string>>();

async function connectionToken(userId: string) {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('google_calendar_connections').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Google Calendar is not connected.');
  const connection = data as GoogleCalendarConnection;
  if (new Date(connection.expires_at).getTime() >= Date.now() + 60_000) return connection.access_token;
  if (!connection.refresh_token) throw new Error('Google Calendar is not connected. Conecte novamente.');
  const refreshed = await refreshGoogleAccessToken(connection.refresh_token);
  const saved = await db.from('google_calendar_connections').update({
    access_token: refreshed.access_token, refresh_token: refreshed.refresh_token || connection.refresh_token,
    expires_at: getTokenExpiration(refreshed.expires_in), scope: refreshed.scope || connection.scope,
    token_type: refreshed.token_type || connection.token_type, updated_at: new Date().toISOString(),
  }).eq('user_id', userId);
  if (saved.error) throw saved.error;
  return refreshed.access_token;
}

export async function getConnectionAccessToken(userId: string) {
  const pending = pendingTokens.get(userId);
  if (pending) return pending;
  const promise = connectionToken(userId);
  pendingTokens.set(userId, promise);
  try { return await promise; }
  finally { if (pendingTokens.get(userId) === promise) pendingTokens.delete(userId); }
}

export async function googleCalendarErrorResponse(error: unknown, userId?: string) {
  if (error instanceof GoogleCalendarScopeRequiredError) return Response.json({ error: error.message, reconnectRequired: true, permissionRequired: true }, { status: 409 });
  if (isGoogleReconnectRequiredError(error)) {
    if (userId) await getSupabaseAdmin().from('google_calendar_connections').delete().eq('user_id', userId);
    return Response.json({ error: 'Sua conexão com o Google Calendar expirou. Conecte novamente.', reconnectRequired: true }, { status: 409 });
  }
  const message = error instanceof Error ? error.message : 'Erro ao acessar Google Agenda.';
  const disconnected = message.includes('not connected');
  return Response.json({ error: message, ...(disconnected ? { reconnectRequired: true } : {}) }, { status: disconnected ? 409 : 500 });
}
