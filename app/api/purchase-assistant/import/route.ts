import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { normalizePermissionSector } from "@/lib/permissions";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { requireAuthenticatedProfile } from "@/lib/server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type GenericRow = Record<string, string>;

const FIELD_ALIASES: Record<string, string[]> = {
  ean: ["EAN", "GTIN", "COD BARRAS", "CODIGO DE BARRAS", "CODIGO EAN"],
  code: ["CODIGO", "COD PRODUTO", "CODIGO PRODUTO", "SKU", "COD FORNECEDOR"],
  description: ["DESCRICAO", "DESCRICAO PRODUTO", "PRODUTO", "ITEM", "NOME"],
  price: ["PRECO", "PRECO NF", "VALOR NF", "CUSTO", "VALOR", "PRECO LIQUIDO"],
  stock: ["ESTOQUE", "SALDO", "DISPONIVEL", "QTD ESTOQUE", "QUANTIDADE"],
  supplier: ["FORNECEDOR", "DISTRIBUIDOR", "SUPPLIER"],
  manufacturer: ["LABORATORIO", "FABRICANTE", "MARCA", "INDUSTRIA"],
};

function canManageImports(role: string, sector: string) {
  return role === "admin" || normalizePermissionSector(sector).startsWith("compras");
}

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeader(value: string) {
  return normalizeText(value).replace(/[^A-Z0-9]+/g, " ").trim();
}

function decodeBuffer(buffer: ArrayBuffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

function parseDelimitedRows(csvText: string) {
  const firstLine = csvText.split(/\r?\n/)[0] || "";
  const delimiter = (firstLine.match(/;/g)?.length || 0) >= (firstLine.match(/,/g)?.length || 0) ? ";" : ",";
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;
  const text = csvText.replace(/^\uFEFF/, "");

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(current.trim());
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function workbookRows(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false, raw: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("A planilha nao possui abas.");
  const sheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false })
    .map((row) => row.map((cell) => String(cell || "").trim()));
}

function rowsFromJson(text: string) {
  const parsed = JSON.parse(text) as unknown;
  const array = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === "object" && "data" in parsed ? (parsed as { data?: unknown }).data : null);
  if (!Array.isArray(array)) throw new Error("JSON precisa ser uma lista de objetos ou possuir campo data.");

  return array
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((item) => Object.fromEntries(Object.entries(item).map(([key, value]) => [key, value == null ? "" : String(value)])));
}

function rowsFromFile(fileName: string, buffer: ArrayBuffer) {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) return rowsFromMatrix(workbookRows(buffer));
  const text = decodeBuffer(buffer);
  if (lowerName.endsWith(".json")) return rowsFromJson(text);
  if (lowerName.endsWith(".csv") || lowerName.endsWith(".txt")) return rowsFromMatrix(parseDelimitedRows(text));
  throw new Error("Envie CSV, TXT, XLS, XLSX ou JSON.");
}

function headerScore(row: string[]) {
  const normalized = row.map(normalizeHeader);
  const aliasMatches = Object.values(FIELD_ALIASES)
    .flat()
    .reduce((sum, alias) => sum + (normalized.some((header) => header.includes(normalizeHeader(alias))) ? 1 : 0), 0);
  return row.filter((cell) => String(cell || "").trim()).length + aliasMatches * 3;
}

function rowsFromMatrix(matrix: string[][]): GenericRow[] {
  const candidates = matrix.slice(0, Math.min(matrix.length, 12));
  let headerIndex = 0;
  let bestScore = -1;

  candidates.forEach((row, index) => {
    const score = headerScore(row);
    if (score > bestScore) {
      headerIndex = index;
      bestScore = score;
    }
  });

  const headers = (matrix[headerIndex] || []).map((header, index) => {
    const normalized = String(header || "").trim() || `COLUNA_${index + 1}`;
    return normalized;
  });

  return matrix.slice(headerIndex + 1)
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, String(cells[index] || "").trim()])))
    .filter((row) => Object.values(row).some(Boolean));
}

function findField(row: GenericRow, aliases: string[]) {
  const entry = Object.entries(row).find(([key]) => {
    const header = normalizeHeader(key);
    return aliases.some((alias) => {
      const normalizedAlias = normalizeHeader(alias);
      return header === normalizedAlias || header.includes(normalizedAlias);
    });
  });

  return entry?.[1] || "";
}

function detectedFields(row: GenericRow) {
  return Object.fromEntries(
    Object.entries(FIELD_ALIASES)
      .map(([field, aliases]) => [field, findField(row, aliases)])
      .filter(([, value]) => Boolean(value)),
  );
}

function normalizedRowText(row: GenericRow, detected: Record<string, string>) {
  const rowText = Object.entries(row)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" | ");
  return normalizeText(`${Object.values(detected).join(" ")} ${rowText}`);
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;

    const retrySeconds = checkRateLimit(`purchase-assistant-import:${auth.userId}`, 12, 10 * 60_000);
    if (retrySeconds !== null) return rateLimitResponse(retrySeconds);

    if (!canManageImports(auth.profile.role, auth.profile.sector || "")) {
      return NextResponse.json({ error: "Acesso liberado apenas para Admin ou setor Compras." }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const title = String(formData.get("title") || "").trim();
    const sourceType = String(formData.get("sourceType") || "IMPORTACAO GENERICA").trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Envie um arquivo CSV, TXT, XLS, XLSX ou JSON." }, { status: 400 });
    }

    const rows = rowsFromFile(file.name, await file.arrayBuffer()).slice(0, 10000);
    if (!rows.length) {
      return NextResponse.json({ error: "Nenhuma linha valida encontrada." }, { status: 400 });
    }

    const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 120);
    const supabase = getSupabaseAdmin();
    const { data: importRecord, error: importError } = await supabase
      .from("purchase_assistant_imports")
      .insert({
        title: title || file.name,
        source_file: file.name,
        source_type: sourceType,
        columns,
        row_count: rows.length,
        imported_by: auth.userId,
      })
      .select("id")
      .single();

    if (importError) throw importError;

    const importId = String(importRecord.id);
    const mappedRows = rows.map((row, index) => {
      const fields = detectedFields(row);
      return {
        import_id: importId,
        row_number: index + 1,
        row_data: row,
        detected_fields: fields,
        normalized_text: normalizedRowText(row, fields),
      };
    });

    const chunkSize = 800;
    for (let index = 0; index < mappedRows.length; index += chunkSize) {
      const { error } = await supabase
        .from("purchase_assistant_import_rows")
        .insert(mappedRows.slice(index, index + chunkSize));

      if (error) throw error;
    }

    return NextResponse.json({
      importId,
      imported: rows.length,
      columns: columns.length,
      title: title || file.name,
      sourceFile: file.name,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel importar arquivo para o assistente.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
