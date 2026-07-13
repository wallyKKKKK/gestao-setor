import { NextResponse } from "next/server";
import { normalizePermissionSector } from "@/lib/permissions";
import { requireAuthenticatedProfile } from "@/lib/server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

function canManageMargins(role: string, sector: string) {
  const normalizedSector = normalizePermissionSector(sector || "");
  return role === "admin" || normalizedSector === "price" || normalizedSector.startsWith("precificacao");
}

function normalizeText(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function normalizePercent(value: unknown) {
  const numeric = Number(String(value ?? "").replace(/[^\d,.-]/g, "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : 0;
}

function pathFor(line: string, department: string, category: string, fallback: string) {
  const pieces = [line, department, category].map((item) => item.trim()).filter(Boolean);
  return fallback || ["PRINCIPAL", ...pieces].join(" > ");
}

function isMissingMarginRulesTable(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: string }).code === "PGRST205";
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;

    if (!canManageMargins(auth.profile.role, auth.profile.sector || "")) {
      return NextResponse.json({ error: "Acesso liberado apenas para Admin ou setor Price." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as {
      id?: string;
      line?: string;
      department?: string;
      category?: string;
      classification_path?: string;
      desired_margin_percent?: number | string;
      desired_markup_percent?: number | string;
      source_file?: string | null;
      is_active?: boolean;
    };

    const line = normalizeText(body.line);
    const department = normalizeText(body.department);
    const category = normalizeText(body.category);
    const classificationPath = pathFor(line, department, category, normalizeText(body.classification_path));

    if (!line || !category) {
      return NextResponse.json({ error: "Preencha linha e categoria." }, { status: 400 });
    }

    const payload = {
      line,
      department,
      category,
      classification_path: classificationPath,
      desired_margin_percent: normalizePercent(body.desired_margin_percent),
      desired_markup_percent: normalizePercent(body.desired_markup_percent),
      source_file: body.source_file || "cadastros",
      is_active: body.is_active !== false,
    };
    const supabase = getSupabaseAdmin();
    const query = body.id
      ? supabase.from("pricing_margin_rules").update(payload).eq("id", body.id).select("*").single()
      : supabase.from("pricing_margin_rules").upsert(payload, { onConflict: "classification_path" }).select("*").single();

    const { data, error } = await query;
    if (isMissingMarginRulesTable(error)) {
      return NextResponse.json({
        error: "A tabela de margens ainda nao existe no Supabase. Rode o SQL supabase/pricing-margin-rules.sql e tente novamente.",
      }, { status: 400 });
    }
    if (error) throw error;

    return NextResponse.json({ rule: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao salvar regra de margem.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;

    if (!canManageMargins(auth.profile.role, auth.profile.sector || "")) {
      return NextResponse.json({ error: "Acesso liberado apenas para Admin ou setor Price." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as { id?: string };
    const id = String(body.id || "").trim();
    if (!id) return NextResponse.json({ error: "Informe a regra para excluir." }, { status: 400 });

    const { error } = await getSupabaseAdmin()
      .from("pricing_margin_rules")
      .delete()
      .eq("id", id);

    if (isMissingMarginRulesTable(error)) {
      return NextResponse.json({
        error: "A tabela de margens ainda nao existe no Supabase. Rode o SQL supabase/pricing-margin-rules.sql e tente novamente.",
      }, { status: 400 });
    }

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao excluir regra de margem.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
