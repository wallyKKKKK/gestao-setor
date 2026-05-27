import { buildGoogleAuthUrl, getGoogleCalendarConfig } from "@/lib/google-calendar";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return Response.json({ error: "Missing userId." }, { status: 400 });
  }

  if (!getGoogleCalendarConfig().isConfigured) {
    return Response.json({ error: "Google Calendar integration is not configured." }, { status: 503 });
  }

  return Response.redirect(buildGoogleAuthUrl(userId));
}
