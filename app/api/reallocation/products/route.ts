import { NextResponse } from "next/server";
import { isPerfumePurchasingSector, normalizePermissionSector } from "@/lib/permissions";
import { requireAuthenticatedProfile } from "@/lib/server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

function canManageProductCatalog(role: string, sector: string) {
  const normalizedSector = normalizePermissionSector(sector || "");
  return role === "admin"
    || normalizedSector === "price"
    || normalizedSector.startsWith("precificacao")
    || isPerfumePurchasingSector(sector || "");
}

function normalizeSearch(...values: string[]) {
  return values
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCode(value: unknown) {
  return String(value || "").replace(/[^\dA-Za-z]/g, "").trim();
}

function normalizeText(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;

    if (!canManageProductCatalog(auth.profile.role, auth.profile.sector || "")) {
      return NextResponse.json({ error: "Acesso liberado apenas para Admin, Price ou Compras Perfumaria." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as {
      id?: string;
      erp_code?: string;
      ean?: string;
      description?: string;
      manufacturer?: string;
      classification?: string;
      source_file?: string | null;
    };

    const erpCode = normalizeCode(body.erp_code);
    const ean = normalizeCode(body.ean);
    const description = normalizeText(body.description);
    const manufacturer = normalizeText(body.manufacturer);
    const classification = normalizeText(body.classification);

    if (!erpCode || !ean || !description) {
      return NextResponse.json({ error: "Preencha codigo ERP, EAN e descricao." }, { status: 400 });
    }

    const payload = {
      erp_code: erpCode,
      ean,
      description,
      manufacturer,
      classification,
      search_text: normalizeSearch(erpCode, ean, description, manufacturer, classification),
      source_file: body.source_file || "cadastros",
    };
    const supabase = getSupabaseAdmin();
    const query = body.id
      ? supabase.from("reallocation_products").update(payload).eq("id", body.id).select("*").single()
      : supabase.from("reallocation_products").upsert(payload, { onConflict: "erp_code,ean" }).select("*").single();

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ product: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao salvar produto mestre.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;

    if (!canManageProductCatalog(auth.profile.role, auth.profile.sector || "")) {
      return NextResponse.json({ error: "Acesso liberado apenas para Admin, Price ou Compras Perfumaria." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as { id?: string };
    const id = String(body.id || "").trim();
    if (!id) {
      return NextResponse.json({ error: "Informe o produto para excluir." }, { status: 400 });
    }

    const { error } = await getSupabaseAdmin()
      .from("reallocation_products")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao excluir produto mestre.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
