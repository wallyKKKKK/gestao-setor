import { NextResponse } from "next/server";
import { isPricingSector } from "@/lib/permissions";
import { requireAuthenticatedProfile } from "@/lib/server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

function forbidden() {
  return NextResponse.json({ error: "Acesso liberado apenas para admin ou setor de precificacao." }, { status: 403 });
}

function cleanText(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function intValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

const allowedScopeTypes = new Set(['product', 'manufacturer', 'line', 'department', 'category', 'classification', 'validity']);

async function requirePricing(request: Request) {
  const auth = await requireAuthenticatedProfile(request);
  if (!auth.ok) return auth;
  if (auth.profile.role !== "admin" && !isPricingSector(auth.profile.sector || "")) {
    return { ok: false as const, response: forbidden() };
  }
  return auth;
}

export async function GET(request: Request) {
  try {
    const auth = await requirePricing(request);
    if (!auth.ok) return auth.response;

    const { data, error } = await getSupabaseAdmin()
      .from("expiring_discount_rules")
      .select("*")
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") return NextResponse.json({ rules: [], missingTable: true });
      throw error;
    }

    return NextResponse.json({ rules: data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel carregar regras.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requirePricing(request);
    if (!auth.ok) return auth.response;
    const body = await request.json();
    const requestedScopeType = String(body.scope_type || "category");
    const scopeType = allowedScopeTypes.has(requestedScopeType) ? requestedScopeType : "category";
    const payload = {
      name: cleanText(body.name),
      scope_type: scopeType,
      scope_value: scopeType === "validity" ? "VALIDADE" : cleanText(body.scope_value),
      discount_type: body.discount_type || "percent",
      discount_value: numberValue(body.discount_value),
      min_days_to_expire: intValue(body.min_days_to_expire, 0),
      max_days_to_expire: intValue(body.max_days_to_expire, 99999),
      priority: intValue(body.priority, 100),
      is_active: body.is_active !== false,
      created_by: auth.userId,
    };

    if (!payload.name || !payload.scope_value) {
      return NextResponse.json({ error: "Informe nome e valor da regra." }, { status: 400 });
    }

    const query = body.id
      ? getSupabaseAdmin().from("expiring_discount_rules").update(payload).eq("id", body.id).select("*").single()
      : getSupabaseAdmin().from("expiring_discount_rules").insert([payload]).select("*").single();
    const { data, error } = await query;

    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") {
        return NextResponse.json({ error: "A tabela de regras de pre-vencidos ainda nao existe. Rode o SQL supabase/expiring-products.sql no Supabase." }, { status: 400 });
      }
      throw error;
    }

    return NextResponse.json({ rule: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel salvar regra.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requirePricing(request);
    if (!auth.ok) return auth.response;
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: "ID nao informado." }, { status: 400 });

    const { error } = await getSupabaseAdmin().from("expiring_discount_rules").delete().eq("id", body.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel excluir regra.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}