import { NextResponse } from "next/server";
import { isPricingSector } from "@/lib/permissions";
import { requireAuthenticatedProfile } from "@/lib/server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const allowedScopes = new Set(["all", "brand", "line", "department", "category", "quote_group"]);
const allowedBases = new Set(["cost", "lowest_competitor", "average_competitor"]);

function forbidden() {
  return NextResponse.json({ error: "Acesso liberado apenas para admin ou setor de precificacao." }, { status: 403 });
}

function cleanText(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function numberValue(value: unknown) {
  const number = Number(String(value ?? "").replace(/[^\d,.-]/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function isMissingTable(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (["42P01", "PGRST205"].includes(String((error as { code?: string }).code)));
}

function dbRuleToApp(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name || ""),
    scope: String(row.scope || "all"),
    scopeValue: String(row.scope_value || ""),
    targetMarkup: numberValue(row.target_markup),
    minMarkup: numberValue(row.min_markup),
    competitorBuffer: numberValue(row.competitor_buffer),
    basis: String(row.basis || "cost"),
    active: row.is_active !== false,
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

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
      .from("pricing_rules")
      .select("*")
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ rules: [], missingTable: true });
      throw error;
    }

    return NextResponse.json({ rules: (data || []).map((row) => dbRuleToApp(row as Record<string, unknown>)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel carregar regras de preco.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requirePricing(request);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const requestedScope = String(body.scope || "all");
    const requestedBasis = String(body.basis || "cost");
    const scope = allowedScopes.has(requestedScope) ? requestedScope : "all";
    const basis = allowedBases.has(requestedBasis) ? requestedBasis : "cost";

    const payload = {
      name: cleanText(body.name),
      scope,
      scope_value: scope === "all" ? "" : cleanText(body.scopeValue),
      target_markup: numberValue(body.targetMarkup),
      min_markup: numberValue(body.minMarkup),
      competitor_buffer: numberValue(body.competitorBuffer),
      basis,
      is_active: body.active !== false,
      created_by: auth.userId,
    };

    if (!payload.name) {
      return NextResponse.json({ error: "Informe o nome da regra." }, { status: 400 });
    }
    if (payload.scope !== "all" && !payload.scope_value) {
      return NextResponse.json({ error: "Escolha o alvo da regra." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const query = body.id
      ? supabase.from("pricing_rules").update(payload).eq("id", body.id).select("*").single()
      : supabase.from("pricing_rules").insert([payload]).select("*").single();

    const { data, error } = await query;
    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json({ error: "A tabela de regras de preco ainda nao existe. Rode o SQL supabase/pricing-rules.sql no Supabase." }, { status: 400 });
      }
      throw error;
    }

    return NextResponse.json({ rule: dbRuleToApp(data as Record<string, unknown>) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel salvar regra de preco.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requirePricing(request);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    if (!id) return NextResponse.json({ error: "ID nao informado." }, { status: 400 });

    const { error } = await getSupabaseAdmin().from("pricing_rules").delete().eq("id", id);
    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json({ error: "A tabela de regras de preco ainda nao existe. Rode o SQL supabase/pricing-rules.sql no Supabase." }, { status: 400 });
      }
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel excluir regra de preco.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
