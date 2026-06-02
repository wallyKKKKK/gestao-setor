import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireRole } from "@/lib/server-auth";

interface CatalogRow {
  erp_code: string;
  ean: string;
  description: string;
  manufacturer: string;
  classification: string;
  search_text: string;
  source_file: string;
}

interface AttributeRow {
  ean: string;
  description: string;
  manufacturer: string;
  classification: string;
}

function parseDelimitedRows(csvText: string) {
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

    if (char === ";" && !inQuotes) {
      row.push(current.trim());
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current.trim());
      if (row.some((cell) => cell)) rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current.trim());
  if (row.some((cell) => cell)) rows.push(row);
  return rows;
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

function normalizeCode(value: string) {
  return value.replace(/[^\dA-Za-z]/g, "").trim();
}

function parseCatalogCsv(csvText: string, sourceFile: string) {
  const [headerRow = [], ...dataRows] = parseDelimitedRows(csvText);
  const headers = headerRow.map((header) => normalizeSearch(header));
  const erpIndex = headers.findIndex((header) => header.includes("CODIGO PRODUTO") || header === "CODIGO");
  const descriptionIndex = headers.findIndex((header) => header.includes("DESCRICAO") || header === "PRODUTO" || header.includes("PRODUTO"));
  const eanIndex = headers.findIndex((header) => header.includes("BARRA") || header.includes("EAN"));
  const manufacturerIndex = headers.findIndex((header) => header.includes("FABRICANTE"));
  const classificationIndex = headers.findIndex((header) => header.includes("CLASSIFICACAO"));

  if (descriptionIndex < 0 || eanIndex < 0) {
    throw new Error("CSV precisa ter pelo menos as colunas Descricao e Barra/EAN.");
  }

  const rows: CatalogRow[] = [];
  const attributes: AttributeRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  dataRows.forEach((cells) => {
    const erpCode = erpIndex >= 0 ? normalizeCode(String(cells[erpIndex] || "")) : "";
    const description = String(cells[descriptionIndex] || "").trim();
    const ean = normalizeCode(String(cells[eanIndex] || ""));
    const manufacturer = manufacturerIndex >= 0 ? String(cells[manufacturerIndex] || "").trim().toUpperCase() : "";
    const classification = classificationIndex >= 0 ? String(cells[classificationIndex] || "").trim().toUpperCase() : "";

    if (!description || !ean) {
      skipped += 1;
      return;
    }

    if (!erpCode) {
      attributes.push({
        ean,
        description: description.toUpperCase(),
        manufacturer,
        classification,
      });
      return;
    }

    const key = `${erpCode}::${ean}`;
    if (seen.has(key)) {
      skipped += 1;
      return;
    }

    seen.add(key);
    rows.push({
      erp_code: erpCode,
      ean,
      description: description.toUpperCase(),
      manufacturer,
      classification,
      search_text: normalizeSearch(erpCode, ean, description, manufacturer, classification),
      source_file: sourceFile,
    });
  });

  return { rows, attributes, skipped };
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ["admin"]);
    if (!auth.ok) return auth.response;

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Envie um arquivo CSV." }, { status: 400 });
    }

    const csvText = await file.text();
    if (!file.name.toLowerCase().endsWith(".csv")) {
      return NextResponse.json({ error: "Por enquanto importe esta tabela em CSV. No Excel, use Salvar como CSV UTF-8." }, { status: 400 });
    }

    const { rows, attributes, skipped } = parseCatalogCsv(csvText, file.name);

    if (!rows.length && !attributes.length) {
      return NextResponse.json({ error: "Nenhum produto valido encontrado." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const chunkSize = 1000;
    const enrichmentChunkSize = 200;
    let imported = 0;
    let enriched = 0;
    let unmatched = 0;

    for (let index = 0; index < rows.length; index += chunkSize) {
      const chunk = rows.slice(index, index + chunkSize);
      const { error } = await supabase
        .from("reallocation_products")
        .upsert(chunk, { onConflict: "erp_code,ean" });

      if (error) throw error;
      imported += chunk.length;
    }

    for (let index = 0; index < attributes.length; index += enrichmentChunkSize) {
      const chunk = attributes.slice(index, index + enrichmentChunkSize);
      const eans = Array.from(new Set(chunk.map((row) => row.ean)));
      const { data: existingProducts, error: existingError } = await supabase
        .from("reallocation_products")
        .select("erp_code,ean,description,source_file")
        .in("ean", eans);

      if (existingError) throw existingError;
      unmatched += Math.max(0, eans.length - new Set((existingProducts || []).map((product) => product.ean)).size);

      const attributesByEan = new Map(chunk.map((row) => [row.ean, row]));
      const payload = (existingProducts || []).map((product) => {
        const attribute = attributesByEan.get(product.ean);
        return {
          erp_code: product.erp_code,
          ean: product.ean,
          description: product.description || attribute?.description || "",
          manufacturer: attribute?.manufacturer || "",
          classification: attribute?.classification || "",
          search_text: normalizeSearch(product.erp_code, product.ean, product.description || attribute?.description || "", attribute?.manufacturer || "", attribute?.classification || ""),
          source_file: product.source_file || file.name,
        };
      });

      if (payload.length > 0) {
        const { error } = await supabase
          .from("reallocation_products")
          .upsert(payload, { onConflict: "erp_code,ean" });

        if (error) throw error;
        enriched += payload.length;
      }
    }

    return NextResponse.json({
      imported,
      enriched,
      unmatched,
      skipped,
      total: rows.length + attributes.length + skipped,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao importar catalogo.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
