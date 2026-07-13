import { NextResponse } from "next/server";
import { isPerfumePurchasingSector, normalizePermissionSector } from "@/lib/permissions";
import { requireAuthenticatedProfile } from "@/lib/server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type ProductAttributeField = "manufacturer" | "classification";

const ATTRIBUTE_SUMMARY_CACHE_MS = 5 * 60 * 1000;
const attributeSummaryCache = new Map<ProductAttributeField, {
  expiresAt: number;
  options: Array<{ value: string; count: number }>;
}>();

interface ProductRow {
  id: string;
  erp_code: string;
  ean: string;
  description: string;
  manufacturer: string;
  classification: string;
  source_file: string | null;
}

function canManageProductCatalog(role: string, sector: string) {
  const normalizedSector = normalizePermissionSector(sector || "");
  return role === "admin"
    || normalizedSector === "price"
    || normalizedSector.startsWith("precificacao")
    || isPerfumePurchasingSector(sector || "");
}

function parseField(value: string | null): ProductAttributeField | null {
  return value === "manufacturer" || value === "classification" ? value : null;
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

function normalizeAttribute(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

async function fetchAllRowsByAttribute(field: ProductAttributeField, value: string) {
  const supabase = getSupabaseAdmin();
  const rows: ProductRow[] = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("reallocation_products")
      .select("id,erp_code,ean,description,manufacturer,classification,source_file")
      .eq(field, value)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;

    const page = (data || []) as ProductRow[];
    rows.push(...page);

    if (page.length < pageSize) break;
  }

  return rows;
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const field = parseField(url.searchParams.get("field"));
    if (!field) {
      return NextResponse.json({ error: "Informe field como manufacturer ou classification." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const cached = attributeSummaryCache.get(field);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({ options: cached.options });
    }

    const counts = new Map<string, number>();
    const pageSize = 1000;

    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase
        .from("reallocation_products")
        .select(field)
        .neq(field, "")
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) throw error;

      const rows = (data || []) as Array<Record<ProductAttributeField, string>>;
      rows.forEach((row) => {
        const value = String(row[field] || "").trim();
        if (!value) return;
        counts.set(value, (counts.get(value) || 0) + 1);
      });

      if (rows.length < pageSize) break;
    }

    const options = Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value, "pt-BR"));

    attributeSummaryCache.set(field, {
      expiresAt: Date.now() + ATTRIBUTE_SUMMARY_CACHE_MS,
      options,
    });

    return NextResponse.json({ options });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao carregar atributos de produtos.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;

    if (!canManageProductCatalog(auth.profile.role, auth.profile.sector || "")) {
      return NextResponse.json({ error: "Acesso liberado apenas para Admin, Price ou Compras Perfumaria." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as {
      field?: string;
      fromValue?: string;
      toValue?: string;
    };
    const field = parseField(body.field || null);
    const fromValue = String(body.fromValue || "").trim();
    const toValue = normalizeAttribute(body.toValue);

    attributeSummaryCache.clear();

    if (!field || !fromValue || !toValue) {
      return NextResponse.json({ error: "Informe campo, valor atual e novo valor." }, { status: 400 });
    }

    if (normalizeAttribute(fromValue) === toValue) {
      return NextResponse.json({ updated: 0 });
    }

    const rows = await fetchAllRowsByAttribute(field, fromValue);
    if (!rows.length) {
      return NextResponse.json({ updated: 0 });
    }

    const supabase = getSupabaseAdmin();
    const chunkSize = 500;

    for (let index = 0; index < rows.length; index += chunkSize) {
      const payload = rows.slice(index, index + chunkSize).map((row) => {
        const manufacturer = field === "manufacturer" ? toValue : row.manufacturer;
        const classification = field === "classification" ? toValue : row.classification;

        return {
          id: row.id,
          erp_code: row.erp_code,
          ean: row.ean,
          description: row.description,
          manufacturer,
          classification,
          search_text: normalizeSearch(row.erp_code, row.ean, row.description, manufacturer, classification),
          source_file: row.source_file || "cadastros",
        };
      });

      const { error } = await supabase
        .from("reallocation_products")
        .upsert(payload, { onConflict: "id" });

      if (error) throw error;
    }

    return NextResponse.json({ updated: rows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao atualizar atributo de produtos.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
