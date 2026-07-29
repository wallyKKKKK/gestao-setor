import { NextResponse } from "next/server";
import { isPricingSector } from "@/lib/permissions";
import { requireAuthenticatedProfile } from "@/lib/server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

function forbidden() {
  return NextResponse.json({ error: "Acesso liberado apenas para admin ou setor de precificacao." }, { status: 403 });
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;
    if (auth.profile.role !== "admin" && !isPricingSector(auth.profile.sector || "")) return forbidden();

    const { data, error } = await getSupabaseAdmin()
      .from("expiring_inventory_items")
      .select("*")
      .eq("is_active", true)
      .order("days_to_expire", { ascending: true })
      .order("description", { ascending: true })
      .limit(10000);

    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") return NextResponse.json({ items: [], missingTable: true });
      throw error;
    }

    return NextResponse.json({ items: data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel carregar pre-vencidos.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}