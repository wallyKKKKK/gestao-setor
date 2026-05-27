import { exchangeGoogleCodeForTokens, getTokenExpiration, verifyGoogleState } from "@/lib/google-calendar";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const origin = url.origin;

  if (!code || !state) {
    return Response.redirect(`${origin}/?googleCalendar=error`);
  }

  try {
    const userId = verifyGoogleState(state);
    const tokens = await exchangeGoogleCodeForTokens(code);
    const supabase = getSupabaseAdmin();

    const { data: existing } = await supabase
      .from("google_calendar_connections")
      .select("refresh_token")
      .eq("user_id", userId)
      .maybeSingle();

    const { error } = await supabase.from("google_calendar_connections").upsert({
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || existing?.refresh_token || null,
      expires_at: getTokenExpiration(tokens.expires_in),
      scope: tokens.scope,
      token_type: tokens.token_type,
      calendar_id: "primary",
      updated_at: new Date().toISOString(),
    });

    if (error) throw error;

    return Response.redirect(`${origin}/?googleCalendar=connected`);
  } catch (error) {
    console.error("Google Calendar callback failed:", error);
    return Response.redirect(`${origin}/?googleCalendar=error`);
  }
}
