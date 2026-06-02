import { getGoogleCalendarConfig } from "@/lib/google-calendar";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireSelfOrRole } from "@/lib/server-auth";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");
  const config = getGoogleCalendarConfig();

  if (!userId) {
    return Response.json({ configured: config.isConfigured, connected: false });
  }

  if (!config.isConfigured) {
    return Response.json({ configured: false, connected: false });
  }

  const auth = await requireSelfOrRole(request, userId, ["admin"]);
  if (!auth.ok) return auth.response;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("google_calendar_connections")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return Response.json({ configured: true, connected: false, error: error.message }, { status: 500 });
  }

  return Response.json({ configured: true, connected: Boolean(data) });
}
