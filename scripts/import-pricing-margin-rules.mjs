import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

const [, , filePathArg, modeArg] = process.argv;
const sourcePath = filePathArg || "C:/Users/APOIO/Downloads/margens pa.xlsx";
const dryRun = modeArg === "--dry-run";

function readEnv() {
  const envText = fs.readFileSync(".env.local", "utf8");
  return Object.fromEntries(
    envText
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.trim().startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
      }),
  );
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function normalizeText(value) {
  return String(value || "").trim().toUpperCase();
}

function parsePercent(value) {
  if (typeof value === "number") {
    return Number((value <= 1 ? value * 100 : value).toFixed(2));
  }

  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const parsed = Number(raw.replace(/[^\d,.-]/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function pathParts(classificationPath) {
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

function classificationPathFromRow(row, classificationIndex) {
  const explicitPath = normalizeText(row[classificationIndex]);
  if (explicitPath.includes(">")) return explicitPath;

  const splitPath = row
    .slice(classificationIndex, classificationIndex + 4)
    .map((cell) => normalizeText(cell))
    .filter(Boolean);

  if (splitPath.length >= 3 && splitPath[0] === "PRINCIPAL") return splitPath.join(" > ");
  return explicitPath;
}

function parseWorkbook(fileName, buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const rows = [];
  let skipped = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const table = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    const headerIndex = table.findIndex((row) => row.some((cell) => normalizeHeader(cell) === "CLASSIFICACAO"));
    if (headerIndex < 0) continue;

    const headers = (table[headerIndex] || []).map(normalizeHeader);
    const classificationIndex = headers.findIndex((header) => header === "CLASSIFICACAO");
    const markupIndex = headers.findIndex((header) => header.includes("MARKUP"));
    const marginIndex = headers.findIndex((header) => header.includes("MARGEM"));

    for (const row of table.slice(headerIndex + 1)) {
      const classificationPath = classificationPathFromRow(row, classificationIndex);
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

const env = readEnv();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Variaveis NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam existir em .env.local.");
}

const resolvedPath = path.resolve(sourcePath);
const fileName = path.basename(resolvedPath);
const { rows, skipped } = parseWorkbook(fileName, fs.readFileSync(resolvedPath));

let imported = 0;
if (!dryRun) {
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (let index = 0; index < rows.length; index += 1000) {
    const chunk = rows.slice(index, index + 1000);
    const { error } = await supabase
      .from("pricing_margin_rules")
      .upsert(chunk, { onConflict: "classification_path" });

    if (error) throw error;
    imported += chunk.length;
  }
}

console.log(JSON.stringify({
  file: fileName,
  mode: dryRun ? "dry-run" : "update",
  parsed: rows.length,
  imported,
  skipped,
  samples: rows.slice(0, 8).map((row) => ({
    path: row.classification_path,
    line: row.line,
    department: row.department,
    category: row.category,
    margin: row.desired_margin_percent,
    markup: row.desired_markup_percent,
  })),
}, null, 2));
