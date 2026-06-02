import { buildGoogleAuthUrl, getGoogleCalendarConfig } from "@/lib/google-calendar";
import { requireSelfOrRole } from "@/lib/server-auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { userId?: string } | null;
  const userId = body?.userId;
  if (!userId) {
    return Response.json({ error: "Missing userId." }, { status: 400 });
  }

  if (!getGoogleCalendarConfig().isConfigured) {
    return Response.json({ error: "Google Calendar integration is not configured." }, { status: 503 });
  }

  const auth = await requireSelfOrRole(request, userId, ["admin"]);
  if (!auth.ok) return auth.response;

  return Response.json({ url: buildGoogleAuthUrl(userId) });
}
