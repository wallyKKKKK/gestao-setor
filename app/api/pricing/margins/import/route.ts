import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { normalizePermissionSector } from "@/lib/permissions";
import { requireAuthenticatedProfile } from "@/lib/server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type MarginRuleRow = {
  line: string;
  department: string;
  category: string;
  classification_path: string;
  desired_margin_percent: number;
  desired_markup_percent: number;
  source_file: string;
  is_active: boolean;
};

function canManageMargins(role: string, sector: string) {
  const normalizedSector = normalizePermissionSector(sector || "");
  return role === "admin" || normalizedSector === "price" || normalizedSector.startsWith("precificacao");
}

function normalizeHeader(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function normalizeText(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function parsePercent(value: unknown) {
  if (typeof value === "number") {
    return Number((value <= 1 ? value * 100 : value).toFixed(2));
  }

  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const parsed = Number(raw.replace(/[^\d,.-]/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function pathParts(classificationPath: string) {
  const parts = classificationPath
    .split(">")
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .filter((part) => part !== "PRINCIPAL");

  const line = parts[0] || "";
  const department = parts.length >= 3 ? parts[1] : "";
  const category = parts.length >= 2 ? parts[parts.length - 1] : (parts[0] || "");

  return { line, department, category };
}

function isMissingMarginRulesTable(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: string }).code === "PGRST205";
}

function parseWorkbook(fileName: string, buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const rows: MarginRuleRow[] = [];
  let skipped = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const table = XLSX.utils.sheet_to_json<Array<string | number>>(sheet, { header: 1, raw: false, defval: "" });
    const headerIndex = table.findIndex((row) => row.some((cell) => normalizeHeader(cell) === "CLASSIFICACAO"));
    if (headerIndex < 0) continue;

    const headers = (table[headerIndex] || []).map(normalizeHeader);
    const classificationIndex = headers.findIndex((header) => header === "CLASSIFICACAO");
    const markupIndex = headers.findIndex((header) => header.includes("MARKUP"));
    const marginIndex = headers.findIndex((header) => header.includes("MARGEM"));

    for (const row of table.slice(headerIndex + 1)) {
      const classificationPath = normalizeText(row[classificationIndex]);
      if (!classificationPath) {
        skipped += 1;
        continue;
      }

      const { line, department, category } = pathParts(classificationPath);
      if (!line || !category) {
        skipped += 1;
        continue;
      }

      rows.push({
        line,
        department,
        category,
        classification_path: classificationPath,
        desired_margin_percent: parsePercent(row[marginIndex]),
        desired_markup_percent: parsePercent(row[markupIndex]),
        source_file: fileName,
        is_active: true,
      });
    }
  }

  const uniqueRows = Array.from(new Map(rows.map((row) => [row.classification_path, row])).values());
  return { rows: uniqueRows, skipped: skipped + (rows.length - uniqueRows.length) };
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;

    if (!canManageMargins(auth.profile.role, auth.profile.sector || "")) {
      return NextResponse.json({ error: "Acesso liberado apenas para Admin ou setor Price." }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Envie uma planilha XLSX." }, { status: 400 });
    }

    const { rows, skipped } = parseWorkbook(file.name, Buffer.from(await file.arrayBuffer()));
    if (!rows.length) {
      return NextResponse.json({ error: "Nenhuma regra de margem encontrada na planilha." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const chunkSize = 1000;
    let imported = 0;

    for (let index = 0; index < rows.length; index += chunkSize) {
      const chunk = rows.slice(index, index + chunkSize);
      const { error } = await supabase
        .from("pricing_margin_rules")
        .upsert(chunk, { onConflict: "classification_path" });

      if (isMissingMarginRulesTable(error)) {
        return NextResponse.json({
          error: "A tabela de margens ainda nao existe no Supabase. Rode o SQL supabase/pricing-margin-rules.sql e tente importar novamente.",
        }, { status: 400 });
      }

      if (error) throw error;
      imported += chunk.length;
    }

    return NextResponse.json({ imported, skipped, total: rows.length + skipped });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao importar regras de margem.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
