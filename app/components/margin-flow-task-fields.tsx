"use client";

import { TrendingUp } from "lucide-react";
import {
  buildMarginFlowTaskNotes,
  formatMarginPercent,
  marginRuleToTaskData,
  parseMarginFlowTaskNotes,
} from "@/lib/margin-flow-task";
import type { MarginFlowTaskData } from "@/lib/margin-flow-task";
import type { PricingMarginRule } from "@/lib/types";

interface MarginFlowTaskFieldsProps {
  notes: string;
  onNotesChange: (value: string) => void;
  onSelectionChange?: (data: MarginFlowTaskData, notes: string) => void;
  marginRules: PricingMarginRule[];
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))).sort();
}

function normalizeOption(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function MarginFlowTaskFields({ notes, onNotesChange, onSelectionChange, marginRules }: MarginFlowTaskFieldsProps) {
  const { data, cleanNotes } = parseMarginFlowTaskNotes(notes);
  const activeRules = marginRules.filter((rule) => rule.is_active !== false);
  const selectedLine = data?.line || "";
  const selectedDepartment = data?.department || "";
  const selectedCategory = data?.category || "";
  const lineOptions = uniqueSorted(activeRules.map((rule) => rule.line));
  const departmentOptions = uniqueSorted(activeRules
    .filter((rule) => !selectedLine || normalizeOption(rule.line) === selectedLine)
    .map((rule) => rule.department));
  const categoryOptions = uniqueSorted(activeRules
    .filter((rule) => !selectedLine || normalizeOption(rule.line) === selectedLine)
    .filter((rule) => !selectedDepartment || normalizeOption(rule.department) === selectedDepartment)
    .map((rule) => rule.category));

  const selectedRule = activeRules.find((rule) => (
    normalizeOption(rule.line) === selectedLine
    && (!selectedDepartment || normalizeOption(rule.department) === selectedDepartment)
    && normalizeOption(rule.category) === selectedCategory
  ));

  const updateSelection = (nextLine: string, nextDepartment: string, nextCategory: string) => {
    const nextRule = activeRules.find((rule) => (
      normalizeOption(rule.line) === nextLine
      && (!nextDepartment || normalizeOption(rule.department) === nextDepartment)
      && normalizeOption(rule.category) === nextCategory
    ));
    const nextData = nextRule ? marginRuleToTaskData(nextRule) : {
      line: nextLine,
      department: nextDepartment,
      category: nextCategory,
      classificationPath: ["PRINCIPAL", nextLine, nextDepartment, nextCategory].filter(Boolean).join(" > "),
      marginPercent: 0,
      markupPercent: 0,
    };
    const nextNotes = buildMarginFlowTaskNotes(cleanNotes, nextData);
    onNotesChange(nextNotes);
    onSelectionChange?.(nextData, nextNotes);
  };

  if (activeRules.length === 0) {
    return (
      <div className="rounded-[24px] border-2 border-amber-100 bg-amber-50 p-4 md:col-span-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Fluxo de margens</p>
        <p className="mt-1 text-xs font-bold text-amber-900">
          Nenhuma margem cadastrada ainda. Importe a planilha na aba Cadastros &gt; Margens para habilitar linha, departamento e categoria.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[24px] border-2 border-blue-100 bg-blue-50/60 p-4 md:col-span-2">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Fluxo de margens</p>
          <p className="text-xs font-bold text-slate-500">Selecione a hierarquia para trazer margem e markup cadastrados.</p>
        </div>
        <TrendingUp size={20} className="text-blue-600" />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <FlowSelect
          label="Linha"
          value={selectedLine}
          placeholder="Selecionar linha"
          options={lineOptions}
          onChange={(value) => updateSelection(value, "", "")}
        />
        <FlowSelect
          label="Departamento"
          value={selectedDepartment}
          placeholder="Todos/sem departamento"
          options={departmentOptions}
          onChange={(value) => updateSelection(selectedLine, value, "")}
        />
        <FlowSelect
          label="Categoria"
          value={selectedCategory}
          placeholder="Selecionar categoria"
          options={categoryOptions}
          onChange={(value) => updateSelection(selectedLine, selectedDepartment, value)}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <InfoPill label="Margem desejada" value={selectedRule ? formatMarginPercent(Number(selectedRule.desired_margin_percent || 0)) : "-"} />
        <InfoPill label="Markup desejado" value={selectedRule ? formatMarginPercent(Number(selectedRule.desired_markup_percent || 0)) : "-"} />
        <InfoPill label="Caminho" value={data?.classificationPath || "-"} compact />
      </div>
    </div>
  );
}

function FlowSelect({ label, value, placeholder, options, onChange }: { label: string; value: string; placeholder: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-[9px] font-black uppercase text-slate-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-11 w-full rounded-2xl border-2 border-white bg-white px-3 text-[10px] font-black uppercase text-slate-700 outline-none focus:border-blue-600"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function InfoPill({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className="rounded-2xl border border-white bg-white px-4 py-3">
      <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`mt-1 font-black uppercase text-slate-900 ${compact ? "text-[10px] leading-snug" : "text-lg"}`}>{value}</p>
    </div>
  );
}
