import { inflateRawSync } from "node:zlib";
import { NextResponse } from "next/server";
import { requireAuthenticatedProfile } from "@/lib/server-auth";
import type { DiscountMode } from "@/lib/types";

export const runtime = "nodejs";

const COMPETITORS = ["TEM TUDO", "BEM POPULAR", "EXTRAFARMA", "DROGASIL", "AMERICANAS"];
const KNOWN_BRANDS = ["MAMYPOKO", "HUGGIES", "BABYSEC", "TURMA DA MONICA", "PLENITUD", "LIFREE"];
const CITY_BRANCH_CODES: Record<string, string[]> = {
  ABAETETUBA: ["01", "07"],
  CAPANEMA: ["02", "21"],
  "CAPITAO POCO": ["05"],
  CASTANHAL: ["03", "08", "11", "18", "19"],
  "MAE DO RIO": ["20"],
  BARCARENA: ["09"],
  "SANTA ISABEL": ["06"],
  ITAITUBA: ["12", "13"],
  CAMETA: ["04"],
  "QUATRO BOCAS": ["10"],
  PORTEL: ["22"],
};

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

type ImportedProduct = {
  ean: string;
  description: string;
  brand: string;
  purchase_price: number;
  sell_in_value: number;
  sell_in_mode: DiscountMode;
  sell_out_value: number;
  sell_out_mode: DiscountMode;
  trade_value: number;
  trade_mode: DiscountMode;
  sale_price: number;
  baby_wednesday_price: number;
  month_end_price: number;
  competitor_prices: Record<string, number>;
  store_prices: Record<string, number>;
};

function findEndOfCentralDirectory(buffer: Buffer) {
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) return index;
  }

  throw new Error("Arquivo XLSX invalido.");
}

function readZipEntries(buffer: Buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();
  let offset = centralDirectoryOffset;

  for (let count = 0; count < totalEntries; count += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);

    entries.set(name, { name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipText(buffer: Buffer, entries: Map<string, ZipEntry>, name: string) {
  const entry = entries.get(name);
  if (!entry) return "";

  const localOffset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Entrada XLSX invalida.");

  const fileNameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const dataOffset = localOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);
  const content = entry.method === 0 ? compressed : inflateRawSync(compressed, { finishFlush: 2 });

  return content.toString("utf8");
}

function xmlText(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseSharedStrings(xml: string) {
  const strings: string[] = [];
  const itemRegex = /<si[\s\S]*?<\/si>/g;
  const textRegex = /<t(?: [^>]*)?>([\s\S]*?)<\/t>/g;
  const items = xml.match(itemRegex) || [];

  for (const item of items) {
    const parts: string[] = [];
    let match: RegExpExecArray | null;
    textRegex.lastIndex = 0;
    while ((match = textRegex.exec(item))) {
      parts.push(xmlText(match[1]));
    }
    strings.push(parts.join(""));
  }

  return strings;
}

function parseRelationships(xml: string) {
  const relationships = new Map<string, string>();
  const relationshipRegex = /<Relationship\b([^>]*)\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = relationshipRegex.exec(xml))) {
    const attributes = match[1];
    const id = attributes.match(/\bId="([^"]+)"/)?.[1];
    const target = attributes.match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) relationships.set(id, target);
  }

  return relationships;
}

function parseWorkbookSheets(xml: string, relationships: Map<string, string>) {
  const sheets: Array<{ name: string; path: string }> = [];
  const sheetRegex = /<sheet\b([^>]*)\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = sheetRegex.exec(xml))) {
    const attributes = match[1];
    const name = xmlText(attributes.match(/\bname="([^"]+)"/)?.[1] || "");
    const relationshipId = attributes.match(/\br:id="([^"]+)"/)?.[1];
    const target = relationshipId ? relationships.get(relationshipId) : "";
    if (!name || !target) continue;

    const normalizedTarget = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    sheets.push({ name, path: normalizedTarget.replace(/\\/g, "/") });
  }

  return sheets;
}

function columnIndex(reference: string) {
  const letters = reference.replace(/[0-9]/g, "");
  let index = 0;

  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }

  return index - 1;
}

function parseSheetRows(xml: string, sharedStrings: string[]) {
  const rows: Array<Array<string | number>> = [];
  const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g;
  const cellRegex = /<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(xml))) {
    const row: Array<string | number> = [];
    let cellMatch: RegExpExecArray | null;
    cellRegex.lastIndex = 0;

    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      const attributes = cellMatch[1];
      const body = cellMatch[2] || "";
      const ref = attributes.match(/r="([^"]+)"/)?.[1] || "";
      const type = attributes.match(/t="([^"]+)"/)?.[1] || "";
      const value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || "";
      const col = ref ? columnIndex(ref) : row.length;

      if (type === "s") {
        row[col] = sharedStrings[Number(value)] || "";
      } else if (type === "inlineStr" || type === "str") {
        row[col] = xmlText(value);
      } else {
        const numericValue = Number(value);
        row[col] = value === "" || Number.isNaN(numericValue) ? xmlText(value) : numericValue;
      }
    }

    rows.push(row);
  }

  return rows;
}

function normalizeHeader(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase();
}

function normalizeKey(value: unknown) {
  return normalizeHeader(value).replace(/\s+/g, " ");
}

function numeric(value: unknown) {
  if (typeof value === "number") return value;
  const text = String(value || "").replace("R$", "").replace(/\./g, "").replace(",", ".").trim();
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function inferBrand(description: string) {
  const upper = description.toUpperCase();
  return KNOWN_BRANDS.find((brand) => upper.includes(brand)) || "";
}

function getCell(row: Array<string | number>, headers: Map<string, number>, header: string) {
  const index = headers.get(normalizeHeader(header));
  return index === undefined ? "" : row[index];
}

function modeForValue(): DiscountMode {
  return "currency";
}

function branchCodesForSheet(sheetName: string) {
  return CITY_BRANCH_CODES[normalizeKey(sheetName)] || [];
}

function parseProductsFromSheet(rows: Array<Array<string | number>>, sheetName: string) {
  const headerRow = rows.find((row) => row.some((cell) => normalizeHeader(cell) === "BARRAS"));

  if (!headerRow) return [];

  const headers = new Map<string, number>();
  headerRow.forEach((cell, index) => headers.set(normalizeHeader(cell), index));
  const headerIndex = rows.indexOf(headerRow);
  const branchCodes = branchCodesForSheet(sheetName);

  return rows.slice(headerIndex + 1).map((row) => {
    const ean = String(getCell(row, headers, "BARRAS") || "").replace(/\.0$/, "").trim();
    const description = String(getCell(row, headers, "PRODUTO") || "").trim();
    if (!ean || !description) return null;

    const competitor_prices = Object.fromEntries(
      COMPETITORS.map((competitor) => [competitor, numeric(getCell(row, headers, competitor))]),
    );
    const purchase = numeric(getCell(row, headers, "Preco"));
    const sellIn = numeric(getCell(row, headers, "Sell in"));
    const sellOut = numeric(getCell(row, headers, "Sell out"));
    const trade = numeric(getCell(row, headers, "Trade"));
    const salePrice = numeric(getCell(row, headers, "Novo Preco"));
    const store_prices = Object.fromEntries(
      branchCodes
        .map((code): [string, number] => [code, salePrice])
        .filter(([, value]) => value > 0),
    );

    return {
      ean,
      description,
      brand: inferBrand(description),
      purchase_price: purchase,
      sell_in_value: sellIn,
      sell_in_mode: modeForValue(),
      sell_out_value: sellOut,
      sell_out_mode: modeForValue(),
      trade_value: trade,
      trade_mode: modeForValue(),
      sale_price: salePrice,
      baby_wednesday_price: numeric(getCell(row, headers, "Quarta da Fralda")),
      month_end_price: numeric(getCell(row, headers, "Fecha mes")),
      competitor_prices,
      store_prices,
    };
  }).filter(Boolean) as ImportedProduct[];
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedProfile(request);
    if (!auth.ok) return auth.response;

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo nao enviado." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const entries = readZipEntries(buffer);
    const sharedStrings = parseSharedStrings(readZipText(buffer, entries, "xl/sharedStrings.xml"));
    const workbookXml = readZipText(buffer, entries, "xl/workbook.xml");
    const relationships = parseRelationships(readZipText(buffer, entries, "xl/_rels/workbook.xml.rels"));
    const sheets = parseWorkbookSheets(workbookXml, relationships);
    const worksheetTargets = sheets.length ? sheets : [{ name: "Planilha 1", path: "xl/worksheets/sheet1.xml" }];
    const productsByEan = new Map<string, ImportedProduct>();

    for (const sheet of worksheetTargets) {
      const sheetXml = readZipText(buffer, entries, sheet.path);
      if (!sheetXml) continue;

      const rows = parseSheetRows(sheetXml, sharedStrings);
      const sheetProducts = parseProductsFromSheet(rows, sheet.name);

      for (const product of sheetProducts) {
        const existing = productsByEan.get(product.ean);
        if (!existing) {
          productsByEan.set(product.ean, product);
          continue;
        }

        existing.store_prices = { ...existing.store_prices, ...product.store_prices };
      }
    }

    const products = Array.from(productsByEan.values());

    if (!products.length) {
      return NextResponse.json({ error: "Cabecalho BARRAS nao encontrado." }, { status: 400 });
    }

    return NextResponse.json({ products, importedSheets: worksheetTargets.map((sheet) => sheet.name) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel importar a planilha.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
