import { getGoogleCalendarConfig, listGoogleCalendars } from '@/lib/google-calendar';
import { getConnectionAccessToken, googleCalendarErrorResponse } from '@/lib/google-calendar-server';
import { requireSelfOrRole } from '@/lib/server-auth';

export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get('userId');
  if (!userId) return Response.json({ error: 'Usuário não informado.' }, { status: 400 });
  const auth = await requireSelfOrRole(request, userId, []);
  if (!auth.ok) return auth.response;
  if (!getGoogleCalendarConfig().isConfigured) return Response.json({ error: 'Integração Google não configurada.' }, { status: 503 });
  try {
    const calendars = await listGoogleCalendars(await getConnectionAccessToken(userId));
    return Response.json({ calendars: calendars.map(calendar => ({ id: calendar.id, summary: calendar.summaryOverride || calendar.summary, primary: Boolean(calendar.primary), backgroundColor: calendar.backgroundColor, foregroundColor: calendar.foregroundColor, accessRole: calendar.accessRole })) });
  } catch (error) { return googleCalendarErrorResponse(error, userId); }
}
