import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

const [, , filePathArg, modeArg] = process.argv;
const sourcePath = filePathArg || "C:/Users/APOIO/Downloads/Cronograma_Analise_Precos.xlsx";
const dryRun = modeArg === "--dry-run";
const TARGET_SECTOR = "Precificação";
const TARGET_ASSIGNEE_NAME = "SETOR DE PRICING";
const MARGIN_FLOW_CATEGORY = "Fluxo de margens";

function readEnv() {
  const envText = fs.readFileSync(".env.local", "utf8");
  return Object.fromEntries(
    envText
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.trim().startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).replace(/^["']|["']$/g, "")];
      }),
  );
}

function normalizeText(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function normalizeLookup(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function parseMoney(value) {
  const raw = String(value || "").replace(/R\$/gi, "").trim();
  if (!raw) return 0;
  const parsed = Number(raw.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pathParts(classificationPath) {
  const parts = normalizeText(classificationPath)
    .split(">")
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .filter((part) => part !== "PRINCIPAL");

  return {
    line: parts[0] || "",
    department: parts.length >= 3 ? parts[1] : "",
    category: parts.length >= 2 ? parts[parts.length - 1] : (parts[0] || ""),
  };
}

function taskTitle(data) {
  return [data.line, data.department, data.category].map(normalizeText).filter(Boolean).join(" - ");
}

function weekdayId(value) {
  const normalized = normalizeLookup(value);
  if (normalized.startsWith("SEG")) return "seg";
  if (normalized.startsWith("TER")) return "ter";
  if (normalized.startsWith("QUA")) return "qua";
  if (normalized.startsWith("QUI")) return "qui";
  if (normalized.startsWith("SEX")) return "sex";
  return "";
}

function monthlyRepeatFromBusinessDay(dayValue, weekdayValue) {
  const day = Number(String(dayValue || "").replace(/\D/g, ""));
  const weekday = weekdayId(weekdayValue);
  if (!day || !weekday) return "";
  const ordinalNumber = Math.ceil(day / 5);
  const ordinal = ordinalNumber >= 5 ? "last" : String(Math.max(1, ordinalNumber));
  return `mw:${ordinal}:${weekday}`;
}

function buildMarginNotes({ day, weekday, revenue, sourceFile, data }) {
  return [
    "Cronograma de analise de precos.",
    `Dia util: ${day}`,
    `Dia previsto: ${normalizeText(weekday)}`,
    revenue ? `Faturamento base: ${revenue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : null,
    `Origem: ${sourceFile}`,
    "[[MARGIN_FLOW]]",
    JSON.stringify(data),
    "[[/MARGIN_FLOW]]",
  ].filter(Boolean).join("\n");
}

function parseSchedule(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets.Sheet || workbook.Sheets[workbook.SheetNames[0]];
  const table = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  const rows = [];

  for (const row of table.slice(1)) {
    const day = String(row[0] || "").trim();
    const weekday = String(row[1] || "").trim();
    const classificationPath = normalizeText(row[2]);
    if (!day || !classificationPath || !classificationPath.includes(">")) continue;
    const repeatDays = monthlyRepeatFromBusinessDay(day, weekday);
    if (!repeatDays) continue;
    const parts = pathParts(classificationPath);
    if (!parts.line || !parts.category) continue;
    rows.push({
      day,
      weekday,
      classificationPath,
      repeatDays,
      revenue: parseMoney(row[3]),
      ...parts,
    });
  }

  return rows;
}

const env = readEnv();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Variaveis NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam existir em .env.local.");
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const resolvedPath = path.resolve(sourcePath);
const sourceFile = path.basename(resolvedPath);
const scheduleRows = parseSchedule(resolvedPath);

const { data: profiles, error: profileError } = await supabase
  .from("profiles")
  .select("id,full_name,sector,role")
  .order("full_name");
if (profileError) throw profileError;

const assignee = profiles.find((profile) => normalizeLookup(profile.full_name) === normalizeLookup(TARGET_ASSIGNEE_NAME))
  || profiles.find((profile) => normalizeLookup(profile.sector).includes("PRECIFICA"))
  || profiles.find((profile) => profile.role === "admin");
if (!assignee) throw new Error("Nenhum usuario encontrado para atribuir as tarefas.");

const { data: marginRules, error: marginError } = await supabase
  .from("pricing_margin_rules")
  .select("line,department,category,classification_path,desired_margin_percent,desired_markup_percent,is_active");
if (marginError) throw marginError;
const marginByPath = new Map((marginRules || []).map((rule) => [normalizeLookup(rule.classification_path), rule]));

const { data: existingTasks, error: taskError } = await supabase
  .from("tasks")
  .select("id,title,category,notes,sector")
  .eq("category", MARGIN_FLOW_CATEGORY)
  .eq("sector", TARGET_SECTOR);
if (taskError) throw taskError;
const existingKeys = new Set((existingTasks || []).map((task) => {
  const markerMatch = String(task.notes || "").match(/"classificationPath":"([^"]+)"/);
  return markerMatch ? normalizeLookup(markerMatch[1]) : normalizeLookup(task.title);
}));

const parsedRows = scheduleRows.map((row) => {
  const rule = marginByPath.get(normalizeLookup(row.classificationPath));
  const data = {
    line: normalizeText(rule?.line || row.line),
    department: normalizeText(rule?.department || row.department),
    category: normalizeText(rule?.category || row.category),
    classificationPath: normalizeText(rule?.classification_path || row.classificationPath),
    marginPercent: Number(rule?.desired_margin_percent || 0),
    markupPercent: Number(rule?.desired_markup_percent || 0),
  };
  return {
    ...row,
    title: taskTitle(data),
    data,
    matchedMargin: Boolean(rule),
  };
});

const uniqueRows = Array.from(new Map(parsedRows.map((row) => [normalizeLookup(row.data.classificationPath), row])).values());
const rowsToCreate = uniqueRows.filter((row) => !existingKeys.has(normalizeLookup(row.data.classificationPath)));
const payload = rowsToCreate.map((row) => ({
  title: row.title,
  assigned_to: assignee.id,
  status: "pendente",
  category: MARGIN_FLOW_CATEGORY,
  notes: buildMarginNotes({ day: row.day, weekday: row.weekday, revenue: row.revenue, sourceFile, data: row.data }),
  repeat_days: row.repeatDays,
  repeat_interval: 1,
  subtasks: [
    { title: "Revisar margem e markup da categoria", done: false },
    { title: "Analisar custos e precos no Price", done: false },
    { title: "Registrar ajuste ou manter preco", done: false },
  ],
  due_date: null,
  sector: TARGET_SECTOR,
  is_one_off: false,
  priority: "normal",
}));

let inserted = 0;
if (!dryRun && payload.length) {
  for (let index = 0; index < payload.length; index += 100) {
    const chunk = payload.slice(index, index + 100);
    const { error } = await supabase.from("tasks").insert(chunk);
    if (error) throw error;
    inserted += chunk.length;
  }
}

console.log(JSON.stringify({
  file: sourceFile,
  mode: dryRun ? "dry-run" : "insert",
  assignee: { id: assignee.id, name: assignee.full_name, sector: assignee.sector },
  parsed: scheduleRows.length,
  unique: uniqueRows.length,
  matchedMargins: uniqueRows.filter((row) => row.matchedMargin).length,
  existingSkipped: uniqueRows.length - rowsToCreate.length,
  toCreate: rowsToCreate.length,
  inserted,
  ignoredSheets: ["Bimestral"],
  samples: rowsToCreate.slice(0, 8).map((row) => ({
    title: row.title,
    repeatDays: row.repeatDays,
    day: row.day,
    weekday: row.weekday,
    margin: row.data.marginPercent,
    markup: row.data.markupPercent,
  })),
}, null, 2));
