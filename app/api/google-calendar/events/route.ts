import type { CreateMeetingInput } from "@/lib/api";
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  getGoogleCalendarConfig,
  listGoogleCalendarEvents,
} from "@/lib/google-calendar";
import { getConnectionAccessToken, googleCalendarErrorResponse } from '@/lib/google-calendar-server';
import { requireSelfOrRole } from "@/lib/server-auth";

export async function GET(request: Request) {
  if (!getGoogleCalendarConfig().isConfigured) {
    return Response.json({ error: "Google Calendar integration is not configured." }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");
  const timeMin = searchParams.get("timeMin");
  const timeMax = searchParams.get("timeMax");

  if (!userId || !timeMin || !timeMax) {
    return Response.json({ error: "Missing userId, timeMin or timeMax." }, { status: 400 });
  }

  try {
    const auth = await requireSelfOrRole(request, userId, []);
    if (!auth.ok) return auth.response;

    const accessToken = await getConnectionAccessToken(userId);
    if (!Number.isFinite(Date.parse(timeMin)) || !Number.isFinite(Date.parse(timeMax)) || Date.parse(timeMax) <= Date.parse(timeMin)) return Response.json({ error: 'Período inválido.' }, { status: 400 });
    const events = await listGoogleCalendarEvents(accessToken, timeMin, timeMax, searchParams.get('calendarId') || 'primary');
    return Response.json({ events });
  } catch (error) {
    return await googleCalendarErrorResponse(error, userId);
  }
}

export async function POST(request: Request) {
  if (!getGoogleCalendarConfig().isConfigured) {
    return Response.json({ error: "Google Calendar integration is not configured." }, { status: 503 });
  }

  const body = await request.json() as { userId?: string; meeting?: CreateMeetingInput; calendarId?: string };
  if (!body.userId || !body.meeting) {
    return Response.json({ error: "Missing userId or meeting." }, { status: 400 });
  }

  try {
    const auth = await requireSelfOrRole(request, body.userId, []);
    if (!auth.ok) return auth.response;

    const accessToken = await getConnectionAccessToken(body.userId);
    const event = await createGoogleCalendarEvent(accessToken, body.meeting, body.calendarId || 'primary');
    return Response.json({ event });
  } catch (error) {
    return await googleCalendarErrorResponse(error, body.userId);
  }
}

export async function DELETE(request: Request) {
  if (!getGoogleCalendarConfig().isConfigured) {
    return Response.json({ error: "Google Calendar integration is not configured." }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");
  const eventId = searchParams.get("eventId");

  if (!userId || !eventId) {
    return Response.json({ error: "Missing userId or eventId." }, { status: 400 });
  }

  try {
    const auth = await requireSelfOrRole(request, userId, []);
    if (!auth.ok) return auth.response;

    const accessToken = await getConnectionAccessToken(userId);
    await deleteGoogleCalendarEvent(accessToken, eventId, searchParams.get('calendarId') || 'primary');
    return Response.json({ ok: true });
  } catch (error) {
    return await googleCalendarErrorResponse(error, userId);
  }
}
