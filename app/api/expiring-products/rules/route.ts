import { NextResponse } from "next/server";
import { isPricingSector } from "@/lib/permissions";
import { requireAuthenticatedProfile } from "@/lib/server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { expiringA7Kind, isMarkupOffer, isStructuredOffer, normalizeOfferConfig, validOfferValue } from "@/lib/expiring-a7-offer";
import type { ExpiringDiscountType } from "@/lib/types";

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
    const ruleType = body.rule_type;
    if (ruleType !== undefined && ruleType !== 'general' && ruleType !== 'specific') {
      return NextResponse.json({ error: 'Tipo de regra inválido.' }, { status: 400 });
    }
    if (ruleType === 'specific' && scopeType === 'validity') {
      return NextResponse.json({ error: 'Uma regra específica precisa de um filtro de produto, fabricante, classificação ou outro grupo.' }, { status: 400 });
    }
    const requestedDiscountType = String(body.discount_type || "percent");
    if (!Object.prototype.hasOwnProperty.call(expiringA7Kind, requestedDiscountType)) {
      return NextResponse.json({ error: "Tipo de desconto inválido." }, { status: 400 });
    }
    const discountType = requestedDiscountType as ExpiringDiscountType;
    const value = numberValue(body.discount_value);
    const legacyDefault = body.discount_type === undefined && body.discount_value === undefined;
    const structured = isStructuredOffer(discountType);
    const config = normalizeOfferConfig(discountType, body.offer_config);
    if (structured && !config) {
      return NextResponse.json({ error: "Revise as quantidades e valores da oferta. Informe Leve maior que Pague ou até três faixas com quantidades crescentes." }, { status: 400 });
    }
    if (!legacyDefault && !structured && discountType !== 'half_cost_price' && (!validOfferValue(value) || (discountType !== 'fixed_price' && !isMarkupOffer(discountType) && value > 100))) {
      return NextResponse.json({ error: "Informe um valor válido. Percentuais de desconto devem ficar entre 0,0001 e 100." }, { status: 400 });
    }
    if (body.scope_values !== undefined && (!Array.isArray(body.scope_values) || body.scope_values.length > 5000 || body.scope_values.some((value: unknown) => typeof value !== 'string'))) {
      return NextResponse.json({ error: "Seleção de alvos inválida." }, { status: 400 });
    }
    const scopeValues: string[] = scopeType === 'validity' ? ['VALIDADE'] : Array.from(new Set<string>((body.scope_values ?? [body.scope_value]).map((value: unknown) => cleanText(value)).filter(Boolean)));
    const payload = {
      name: cleanText(body.name),
      scope_type: scopeType,
      ...(ruleType !== undefined && { rule_type: ruleType }),
      scope_value: scopeValues[0] || '',
      scope_values: scopeValues,
      discount_type: discountType,
      discount_value: discountType === "half_cost_price" ? 50 : structured ? 0 : value,
      offer_config: config,
      min_days_to_expire: intValue(body.min_days_to_expire, 0),
      max_days_to_expire: intValue(body.max_days_to_expire, 99999),
      ...(body.skip_if_demand_covers_balance !== undefined && {
        skip_if_demand_covers_balance: body.skip_if_demand_covers_balance === true,
      }),
      priority: intValue(body.priority, 100),
      is_active: body.is_active !== false,
      created_by: auth.userId,
    };

    if (!payload.name || !payload.scope_value) {
      return NextResponse.json({ error: "Informe nome e valor da regra." }, { status: 400 });
    }
    if ([body.min_days_to_expire, body.max_days_to_expire].some(value => value !== undefined &&
      (value === null || value === '' || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647)) ||
      payload.min_days_to_expire < 0 || payload.max_days_to_expire < payload.min_days_to_expire) {
      return NextResponse.json({ error: "Informe um intervalo de validade válido." }, { status: 400 });
    }

    const query = body.id
      ? getSupabaseAdmin().from("expiring_discount_rules").update(payload).eq("id", body.id).select("*").single()
      : getSupabaseAdmin().from("expiring_discount_rules").insert([payload]).select("*").single();
    const { data, error } = await query;

    if (error) {
      if (error.code === "23514" && error.message.includes("expiring_discount_rules_discount_type_check")) {
        return NextResponse.json({ error: "O banco ainda não aceita esse tipo de desconto. Aplique a migração expiring-products-a7-offers.sql." }, { status: 400 });
      }
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
