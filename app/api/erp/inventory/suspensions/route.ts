import { NextResponse } from "next/server";
import { requireAuthenticatedProfile } from "@/lib/server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SuspensionRequestItem {
  branchCode?: string;
  branch_code?: string;
  ean?: string;
}

function cleanValue(value: unknown) {
  return String(value || "").trim();
}

function uniqueItems(items: SuspensionRequestItem[]) {
  const seen = new Set<string>();
  const normalized: Array<{ branch_code: string; ean: string }> = [];

  items.forEach((item) => {
    const branchCode = cleanValue(item.branchCode || item.branch_code);
    const ean = cleanValue(item.ean);
    if (!branchCode || !ean) return;

    const key = `${branchCode}::${ean}`;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push({ branch_code: branchCode, ean });
  });

  return normalized;
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const suspended = Boolean(body.suspended);
    const items = uniqueItems(Array.isArray(body.items) ? body.items : []);

    if (!items.length) {
      return NextResponse.json({ error: "Selecione ao menos um item para alterar a suspensao de compra." }, { status: 400 });
    }

    if (items.length > 2000) {
      return NextResponse.json({ error: "Selecione no maximo 2000 itens por vez." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();
    const payload = items.map((item) => ({
      branch_code: item.branch_code,
      ean: item.ean,
      is_suspended: suspended,
      updated_by: auth.userId,
      updated_at: now,
      created_by: auth.userId,
    }));

    const { error } = await supabase
      .from("erp_inventory_purchase_suspensions")
      .upsert(payload, { onConflict: "branch_code,ean" });

    if (error) throw error;

    return NextResponse.json({ updated: items.length, suspended });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["42P01", "PGRST205"].includes(String(error.code))) {
      return NextResponse.json({ error: "Rode o SQL supabase/erp-inventory-purchase-suspensions.sql antes de usar suspensao de compra." }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Nao foi possivel alterar a suspensao de compra.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}