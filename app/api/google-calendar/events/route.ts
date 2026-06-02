import type { CreateMeetingInput } from "@/lib/api";
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  getGoogleCalendarConfig,
  getTokenExpiration,
  listGoogleCalendarEvents,
  type GoogleCalendarConnection,
  refreshGoogleAccessToken,
} from "@/lib/google-calendar";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireSelfOrRole } from "@/lib/server-auth";

async function getConnectionAccessToken(userId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("google_calendar_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Google Calendar is not connected.");

  const connection = data as GoogleCalendarConnection;
  let accessToken = connection.access_token;

  if (new Date(connection.expires_at).getTime() < Date.now() + 60_000) {
    if (!connection.refresh_token) {
      throw new Error("Google refresh token is missing. Reconnect Google Calendar.");
    }

    const refreshed = await refreshGoogleAccessToken(connection.refresh_token);
    accessToken = refreshed.access_token;

    await supabase
      .from("google_calendar_connections")
      .update({
        access_token: refreshed.access_token,
        expires_at: getTokenExpiration(refreshed.expires_in),
        scope: refreshed.scope,
        token_type: refreshed.token_type,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  }

  return accessToken;
}

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
    const auth = await requireSelfOrRole(request, userId, ["admin"]);
    if (!auth.ok) return auth.response;

    const accessToken = await getConnectionAccessToken(userId);
    const events = await listGoogleCalendarEvents(accessToken, timeMin, timeMax);
    return Response.json({ events });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Google Calendar error.";
    return Response.json({ error: message }, { status: message.includes("not connected") ? 409 : 500 });
  }
}

export async function POST(request: Request) {
  if (!getGoogleCalendarConfig().isConfigured) {
    return Response.json({ error: "Google Calendar integration is not configured." }, { status: 503 });
  }

  const body = await request.json() as { userId?: string; meeting?: CreateMeetingInput };
  if (!body.userId || !body.meeting) {
    return Response.json({ error: "Missing userId or meeting." }, { status: 400 });
  }

  try {
    const auth = await requireSelfOrRole(request, body.userId, ["admin"]);
    if (!auth.ok) return auth.response;

    const accessToken = await getConnectionAccessToken(body.userId);
    const event = await createGoogleCalendarEvent(accessToken, body.meeting);
    return Response.json({ event });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Google Calendar error.";
    return Response.json({ error: message }, { status: message.includes("not connected") ? 409 : 500 });
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
    const auth = await requireSelfOrRole(request, userId, ["admin"]);
    if (!auth.ok) return auth.response;

    const accessToken = await getConnectionAccessToken(userId);
    await deleteGoogleCalendarEvent(accessToken, eventId);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Google Calendar error.";
    return Response.json({ error: message }, { status: message.includes("not connected") ? 409 : 500 });
  }
}
