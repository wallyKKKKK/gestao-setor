import { isPricingSector } from "@/lib/permissions";
import type { PricingMarginRule } from "@/lib/types";

export const MARGIN_FLOW_CATEGORY = "Fluxo de margens";

export interface MarginFlowTaskData {
  line: string;
  department: string;
  category: string;
  classificationPath: string;
  marginPercent: number;
  markupPercent: number;
}

const START_MARKER = "[[MARGIN_FLOW]]";
const END_MARKER = "[[/MARGIN_FLOW]]";

function normalizeValue(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function canUseMarginFlowTasks(userSector: string | null | undefined) {
  return isPricingSector(String(userSector || ""));
}

export function parseMarginFlowTaskNotes(notes: string | null | undefined) {
  const rawNotes = String(notes || "");
  const startIndex = rawNotes.indexOf(START_MARKER);
  const endIndex = rawNotes.indexOf(END_MARKER);

  if (startIndex < 0 || endIndex < startIndex) {
    return { data: null as MarginFlowTaskData | null, cleanNotes: rawNotes.trim() };
  }

  const jsonText = rawNotes.slice(startIndex + START_MARKER.length, endIndex).trim();
  const cleanNotes = `${rawNotes.slice(0, startIndex)}${rawNotes.slice(endIndex + END_MARKER.length)}`.trim();

  try {
    const parsed = JSON.parse(jsonText) as Partial<MarginFlowTaskData>;
    const data: MarginFlowTaskData = {
      line: normalizeValue(parsed.line),
      department: normalizeValue(parsed.department),
      category: normalizeValue(parsed.category),
      classificationPath: normalizeValue(parsed.classificationPath),
      marginPercent: Number(parsed.marginPercent || 0),
      markupPercent: Number(parsed.markupPercent || 0),
    };

    if (!data.line && !data.department && !data.category) return { data: null, cleanNotes };
    return { data, cleanNotes };
  } catch {
    return { data: null, cleanNotes };
  }
}

export function buildMarginFlowTaskNotes(notes: string | null | undefined, data: MarginFlowTaskData | null) {
  const { cleanNotes } = parseMarginFlowTaskNotes(notes);
  if (!data) return cleanNotes;

  const normalizedData: MarginFlowTaskData = {
    line: normalizeValue(data.line),
    department: normalizeValue(data.department),
    category: normalizeValue(data.category),
    classificationPath: normalizeValue(data.classificationPath),
    marginPercent: Number(data.marginPercent || 0),
    markupPercent: Number(data.markupPercent || 0),
  };

  return [
    cleanNotes,
    START_MARKER,
    JSON.stringify(normalizedData),
    END_MARKER,
  ].filter(Boolean).join("\n");
}

export function marginRuleToTaskData(rule: PricingMarginRule): MarginFlowTaskData {
  return {
    line: normalizeValue(rule.line),
    department: normalizeValue(rule.department),
    category: normalizeValue(rule.category),
    classificationPath: normalizeValue(rule.classification_path),
    marginPercent: Number(rule.desired_margin_percent || 0),
    markupPercent: Number(rule.desired_markup_percent || 0),
  };
}

export function marginFlowTaskTitle(data: MarginFlowTaskData | null | undefined) {
  if (!data) return "";
  return [data.line, data.department, data.category]
    .map((part) => normalizeValue(part))
    .filter(Boolean)
    .join(" - ");
}

export function formatMarginPercent(value: number) {
  return `${Number(value || 0).toFixed(2).replace(".", ",")}%`;
}
