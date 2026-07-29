import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { isPricingSector } from "@/lib/permissions";
import { requireAuthenticatedProfile } from "@/lib/server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const UPSERT_CHUNK_SIZE = 1000;

type RowMap = Record<string, unknown>;

interface ParsedExpiringInventoryItem {
  row_key: string;
  branch_code: string;
  branch_name: string;
  item_status: string;
  description: string;
  ean: string;
  lot: string;
  initial_quantity: number;
  moved_quantity: number;
  balance_quantity: number;
  current_stock: number;
  days_to_expire: number;
  manufacture_date: string | null;
  expiration_date: string | null;
  manufacturer: string;
  classification_path: string;
  line: string;
  department: string;
  category: string;
  abc_quantity: string;
  abc_value: string;
  imported_user: string;
  included_at: string | null;
  monthly_average: number;
  purchase_demand_30d: number;
  source_file: string;
  imported_by: string;
  imported_at: string;
  is_active: boolean;
}

function forbidden() {
  return NextResponse.json({ error: "Acesso liberado apenas para admin ou setor de precificacao." }, { status: 403 });
}

function normalizeHeader(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function normalizeHeaderKey(value: unknown) {
  return normalizeHeader(value).replace(/[^A-Z0-9]/g, "");
}

function normalizeText(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}
function normalizeBranchCode(value: unknown) {
  const text = normalizeText(value);
  return /^\d$/.test(text) ? `0${text}` : text;
}

function cell(row: RowMap, names: string[]) {
  const entries = Object.entries(row).map(([key, value]) => ({
    header: normalizeHeader(key),
    compact: normalizeHeaderKey(key),
    value,
  }));

  for (const name of names) {
    const normalizedName = normalizeHeader(name);
    const match = entries.find((entry) => entry.header === normalizedName);
    if (match && match.value !== undefined && match.value !== null && String(match.value).trim() !== "") return match.value;
  }

  for (const name of names) {
    const compactName = normalizeHeaderKey(name);
    const match = entries.find((entry) => entry.compact === compactName);
    if (match && match.value !== undefined && match.value !== null && String(match.value).trim() !== "") return match.value;
  }

  for (const name of names) {
    const compactName = normalizeHeaderKey(name);
    if (!compactName || compactName.length < 4) continue;
    const match = entries.find((entry) => entry.compact.includes(compactName) || compactName.includes(entry.compact));
    if (match && match.value !== undefined && match.value !== null && String(match.value).trim() !== "") return match.value;
  }

  return "";
}

function numberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value || "").replace(/R\$/gi, "").replace(/\./g, "").replace(",", ".").trim();
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function integerValue(value: unknown) {
  return Math.trunc(numberValue(value));
}

function dateValue(value: unknown) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }

  const text = String(value).trim();
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (br) {
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${year}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  }

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;
}

function timestampValue(value: unknown) {
  const date = dateValue(value);
  if (!date) return null;
  const text = String(value || "").trim();
  const time = text.match(/(\d{1,2}:\d{2}(?::\d{2})?)/)?.[1] || "00:00:00";
  return `${date}T${time.length === 5 ? `${time}:00` : time}`;
}


function daysUntilExpiration(expirationDate: string | null) {
  if (!expirationDate) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiration = new Date(`${expirationDate}T00:00:00`);
  if (Number.isNaN(expiration.getTime())) return 0;
  return Math.max(0, Math.ceil((expiration.getTime() - today.getTime()) / 86400000));
}
function classificationParts(path: string) {
  const parts = path.split(">").map((part) => normalizeText(part)).filter(Boolean);
  const useful = parts[0] === "PRINCIPAL" ? parts.slice(1) : parts;
  return {
    line: useful[0] || "",
    department: useful[1] || "",
    category: useful[2] || useful[useful.length - 1] || "",
  };
}

function rowKey(input: { branchCode: string; ean: string; lot: string; expirationDate: string | null }) {
  return [input.branchCode, input.ean, input.lot, input.expirationDate || "sem-validade"].join("|");
}

function ensureSheetRange(sheet: XLSX.WorkSheet) {
  const cellAddresses = Object.keys(sheet).filter((key) => !key.startsWith("!"));
  if (!cellAddresses.length) return;

  let minRow = Number.POSITIVE_INFINITY;
  let minCol = Number.POSITIVE_INFINITY;
  let maxRow = 0;
  let maxCol = 0;

  for (const address of cellAddresses) {
    const decoded = XLSX.utils.decode_cell(address);
    minRow = Math.min(minRow, decoded.r);
    minCol = Math.min(minCol, decoded.c);
    maxRow = Math.max(maxRow, decoded.r);
    maxCol = Math.max(maxCol, decoded.c);
  }

  sheet["!ref"] = XLSX.utils.encode_range({ s: { r: minRow, c: minCol }, e: { r: maxRow, c: maxCol } });
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;
    if (auth.profile.role !== "admin" && !isPricingSector(auth.profile.sector || "")) return forbidden();

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo nao enviado." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const rows = workbook.SheetNames.flatMap((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return [];
      ensureSheetRange(sheet);
      return XLSX.utils.sheet_to_json<RowMap>(sheet, { defval: "" });
    });

    const parsed = rows.map((row): ParsedExpiringInventoryItem | null => {
      const branchCode = normalizeBranchCode(cell(row, ["Codigo da Un. Neg.", "Codigo Un. Neg.", "Codigo unidade negocio", "Un. Negocio", "Unidade Negocio", "Codigo loja", "Cod loja", "Filial codigo", "Loja"]));
      const branchName = normalizeText(cell(row, ["Nome da Un. Neg.", "Nome Un. Neg.", "Apelido Un. Neg.", "Unidade", "Filial", "Nome loja", "Loja"]));
      const ean = String(cell(row, ["Cod. Barras/Etiqueta", "Codigo Barras Etiqueta", "Codigo de Barras", "Cod Barras", "Codigo EAN", "EAN", "Barras", "GTIN"])).replace(/\.0$/, "").trim();
      const lot = normalizeText(cell(row, ["Lote", "Numero Lote", "Nro Lote", "Num Lote", "Lote Produto"])) || "SEM LOTE";
      const description = normalizeText(cell(row, ["Embalagem", "Produto", "Descricao", "Descricao Produto", "Nome Produto", "Mercadoria", "Item"]));
      const expirationDate = dateValue(cell(row, ["Data Validade", "Validade", "Vencimento", "Data Vencimento", "Dt Validade", "Dt Vencimento"]));
      const daysCell = cell(row, ["Dias ate vencimento", "Dias ate o vencimento", "Dias Vencimento", "Dias para vencer", "Dias para vencimento", "Dias"]);
      const daysToExpire = daysCell === "" ? daysUntilExpiration(expirationDate) : integerValue(daysCell);
      const classificationPath = normalizeText(cell(row, ["Classificacao do Produto", "Classificacao", "Arvore Mercadologica", "Categoria", "Departamento"]));
      const parts = classificationParts(classificationPath);

      if (!branchCode || !ean) return null;

      return {
        row_key: rowKey({ branchCode, ean, lot, expirationDate }),
        branch_code: branchCode,
        branch_name: branchName,
        item_status: normalizeText(cell(row, ["Status"])),
        description: description || ean,
        ean,
        lot,
        initial_quantity: numberValue(cell(row, ["Quantidade Inicial", "Qtd Inicial", "Qtde Inicial"])),
        moved_quantity: numberValue(cell(row, ["Qtd. Movimentada", "Quantidade Movimentada", "Qtd Movimentada"])),
        balance_quantity: numberValue(cell(row, ["Saldo", "Saldo Atual", "Quantidade", "Qtde", "Qtd"])),
        current_stock: numberValue(cell(row, ["Estoque Atual", "Estoque", "Estoque Loja"])),
        days_to_expire: daysToExpire,
        manufacture_date: dateValue(cell(row, ["Data Fabricacao", "Data Fabricação", "Fabricacao", "Dt Fabricacao"])),
        expiration_date: expirationDate,
        manufacturer: normalizeText(cell(row, ["Nome do Fabricante", "Fabricante", "Marca", "Laboratorio", "Fornecedor"])),
        classification_path: classificationPath,
        line: parts.line,
        department: parts.department,
        category: parts.category,
        abc_quantity: normalizeText(cell(row, ["Curva ABC Quantidade"])),
        abc_value: normalizeText(cell(row, ["Curva ABC Valor"])),
        imported_user: normalizeText(cell(row, ["Usuario", "Usuário", "User", "Operador"])),
        included_at: timestampValue(cell(row, ["Data Hora Inclusao", "Data Hora Inclusão", "Data Inclusao", "Inclusao"])),
        monthly_average: numberValue(cell(row, ["Media Venda Mensal", "Média Venda Mensal", "Media Mensal", "Media Venda"])),
        purchase_demand_30d: numberValue(cell(row, ["Demanda de Compra (Ult. 30 Dias)", "Demanda de Compra (Últ. 30 Dias)", "Demanda Compra 30 Dias", "Demanda Compra"])),
        source_file: file.name,
        imported_by: auth.userId,
        imported_at: new Date().toISOString(),
        is_active: true,
      };
    }).filter((item): item is ParsedExpiringInventoryItem => Boolean(item));

    if (!parsed.length) {
      return NextResponse.json({ error: "Nenhum lote valido encontrado na planilha." }, { status: 400 });
    }

    const deduped = Array.from(new Map(parsed.map((item) => [item.row_key, item])).values());
    const duplicatesIgnored = parsed.length - deduped.length;
    const supabase = getSupabaseAdmin();
    const eans = Array.from(new Set(deduped.map((item) => item.ean).filter(Boolean)));
    const branchCodes = Array.from(new Set(deduped.map((item) => normalizeBranchCode(item.branch_code)).filter(Boolean)));

    const masterRows: Array<{ ean: string | null; description: string | null; manufacturer: string | null; classification: string | null }> = [];
    for (const eanChunk of chunkArray(eans, 500)) {
      const { data, error } = await supabase
        .from("reallocation_products")
        .select("ean,description,manufacturer,classification")
        .in("ean", eanChunk);
      if (error) throw error;
      masterRows.push(...(data || []));
    }

    const branchRows: Array<{ code: string | null; name: string | null }> = [];
    for (const branchChunk of chunkArray(branchCodes, 200)) {
      const { data, error } = await supabase
        .from("pricing_branches")
        .select("code,name")
        .in("code", branchChunk);
      if (error) throw error;
      branchRows.push(...(data || []));
    }

    const masterByEan = new Map(masterRows.map((item) => [String(item.ean || ""), item]));
    const branchByCode = new Map(branchRows.flatMap((branch) => {
      const code = normalizeBranchCode(branch.code);
      return [[String(branch.code || ""), branch], [code, branch]];
    }));

    const enriched = deduped.map((item) => {
      const master = masterByEan.get(item.ean);
      const branch = branchByCode.get(normalizeBranchCode(item.branch_code));
      const classification = normalizeText(master?.classification || item.classification_path);
      const parts = classificationParts(classification);
      return {
        ...item,
        branch_code: normalizeBranchCode(branch?.code || item.branch_code),
        branch_name: normalizeText(branch?.name || item.branch_name),
        description: normalizeText(master?.description || item.description),
        manufacturer: normalizeText(master?.manufacturer || item.manufacturer),
        classification_path: classification,
        line: parts.line,
        department: parts.department,
        category: parts.category,
      };
    });

    for (const enrichedChunk of chunkArray(enriched, UPSERT_CHUNK_SIZE)) {
      const { error } = await supabase
        .from("expiring_inventory_items")
        .upsert(enrichedChunk as Array<Record<string, unknown>>, { onConflict: "row_key" });

      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") {
          return NextResponse.json({ error: "A tabela de pre-vencidos ainda nao existe. Rode o SQL supabase/expiring-products.sql no Supabase." }, { status: 400 });
        }
        throw error;
      }
    }

    return NextResponse.json({ imported: enriched.length, duplicatesIgnored, sheets: workbook.SheetNames });
  } catch (error) {
    console.error("[expiring-products/import]", error);
    const message = error instanceof Error && error.message ? error.message : "Nao foi possivel importar pre-vencidos.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}



