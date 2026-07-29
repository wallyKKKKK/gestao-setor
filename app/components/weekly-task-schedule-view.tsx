'use client';

import * as XLSX from 'xlsx-js-style';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { CalendarDays, CheckCircle2, Clock, Download, UserRound } from 'lucide-react';
import { taskPriorityBadgeClassName, taskPriorityLabel } from '@/lib/task-priority';
import type { ProcessedTask, Profile } from '@/lib/types';

interface WeeklyTaskScheduleViewProps {
  tasks: ProcessedTask[];
  profiles: Profile[];
  selectedUserIds: string[];
  onView: (task: ProcessedTask) => void;
}

interface WeekDayInfo {
  id: string;
  label: string;
  shortLabel: string;
  date: string;
  dayNumber: string;
}

const WEEK_DAYS = [
  { id: 'seg', label: 'Segunda', shortLabel: 'SEG' },
  { id: 'ter', label: 'Terca', shortLabel: 'TER' },
  { id: 'qua', label: 'Quarta', shortLabel: 'QUA' },
  { id: 'qui', label: 'Quinta', shortLabel: 'QUI' },
  { id: 'sex', label: 'Sexta', shortLabel: 'SEX' },
];

function toDateStr(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateBR(dateStr: string) {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

function getCurrentWeekDays(): WeekDayInfo[] {
  const today = new Date();
  const monday = new Date(today);
  const currentDay = today.getDay() === 0 ? 7 : today.getDay();
  monday.setDate(today.getDate() - currentDay + 1);

  return WEEK_DAYS.map((day, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const dateStr = toDateStr(date);

    return {
      ...day,
      date: dateStr,
      dayNumber: String(date.getDate()).padStart(2, '0'),
    };
  });
}

function dateFromBR(value: string | undefined) {
  if (!value || value === '--/--/----' || !value.includes('/')) return '';
  const [day, month, year] = value.split('/');
  return `${year}-${month}-${day}`;
}

function getMonday(date: Date) {
  const monday = new Date(date);
  const currentDay = monday.getDay() === 0 ? 7 : monday.getDay();
  monday.setDate(monday.getDate() - currentDay + 1);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function isWeeklyIntervalWeek(task: ProcessedTask, dateStr: string) {
  const interval = task.repeat_interval || 1;
  if (interval <= 1) return true;

  const createdAt = new Date(task.created_at);
  const targetDate = new Date(dateStr + 'T00:00:00');
  const startMonday = getMonday(createdAt);
  const targetMonday = getMonday(targetDate);
  const weeksSinceStart = Math.floor((targetMonday.getTime() - startMonday.getTime()) / (7 * 24 * 60 * 60 * 1000));

  return weeksSinceStart >= 0 && weeksSinceStart % interval === 0;
}

function taskOccursOnDay(task: ProcessedTask, day: WeekDayInfo) {
  if ((task.category || '').toLowerCase().startsWith('reuni')) return false;

  if (task.schedule_override_date) return task.schedule_override_date === day.date;
  if (task.is_one_off) return task.due_date === day.date;

  const repeatDays = task.repeat_days || '';
  if (!repeatDays) return false;

  const weeklyDays = repeatDays.split(',');
  if (weeklyDays.includes(day.id)) return isWeeklyIntervalWeek(task, day.date);

  return task.lastOcc === day.date || dateFromBR(task.nextOcc) === day.date;
}

function getTaskStatusLabel(task: ProcessedTask, date: string) {
  if (task.last_done_date && task.last_done_date >= date) return 'Concluida';
  if (task.workflow_status === 'em_andamento') return 'Em andamento';
  if (task.workflow_status === 'bloqueada') return 'Bloqueada';
  return 'Pendente';
}

function cleanCellText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function getExcelAutoFitWidth(values: unknown[]) {
  const maxLength = values.reduce<number>((max, value) => {
    const text = cleanCellText(value);
    const visualLength = Array.from(text).reduce<number>((total, char) => total + (char.charCodeAt(0) > 255 ? 1.6 : 1), 0);
    return Math.max(max, visualLength);
  }, 0);

  return Math.min(120, Math.max(14, Math.ceil(maxLength + 4)));
}

function fileSafeText(value: string) {
  return cleanCellText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'cronograma';
}

function getExportTimeStamp() {
  const now = new Date();
  return String(now.getHours()).padStart(2, '0') + 'h' + String(now.getMinutes()).padStart(2, '0');
}

function getExportUserLabel(selectedUserIds: string[], visibleUserIds: string[], profileById: Map<string, Profile>) {
  if (selectedUserIds.length === 1) return profileById.get(selectedUserIds[0])?.full_name || 'usuario';
  if (selectedUserIds.length > 1) return selectedUserIds.length + '-usuarios';
  if (visibleUserIds.length === 1) return profileById.get(visibleUserIds[0])?.full_name || 'usuario';
  return 'todos-usuarios';
}
function safeSheetName(name: string, index: number, usedNames: Set<string>) {
  const base = cleanCellText(name)
    .replace(/[\\/?*:[\]]/g, '-')
    .slice(0, 28) || 'Usuario ' + index;
  let sheetName = base;
  let suffix = 2;

  while (usedNames.has(sheetName.toLowerCase())) {
    const suffixText = ' ' + suffix;
    sheetName = base.slice(0, 31 - suffixText.length) + suffixText;
    suffix += 1;
  }

  usedNames.add(sheetName.toLowerCase());
  return sheetName;
}

function applyScheduleSheetFormatting(worksheet: XLSX.WorkSheet, rows: string[][], weekDays: WeekDayInfo[]) {
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
  const thinBorder = { style: 'thin', color: { rgb: '000000' } };
  const allBorders = {
    top: thinBorder,
    right: thinBorder,
    bottom: thinBorder,
    left: thinBorder,
  };

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      const cell = worksheet[cellAddress] || { t: 's', v: '' };
      cell.s = {
        border: allBorders,
        alignment: { vertical: 'top', wrapText: false },
        font: { name: 'Calibri', sz: 11, bold: rowIndex === 0 },
        fill: rowIndex === 0 ? { fgColor: { rgb: 'D9EAF7' } } : undefined,
      };
      worksheet[cellAddress] = cell;
    }
  }

  worksheet['!cols'] = weekDays.map((_, colIndex) => ({
    wch: getExcelAutoFitWidth(rows.map((row) => row[colIndex])),
    bestFit: true,
  }));
  worksheet['!rows'] = Array.from({ length: rows.length }, (_, index) => ({ hpt: index === 0 ? 22 : 20 }));
  worksheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, rows.length - 1), c: weekDays.length - 1 } }) };
  worksheet['!margins'] = { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
}

function ensureWorksheetPrintSettings(xml: string) {
  let nextXml = xml;

  if (nextXml.includes('<sheetPr')) {
    if (!nextXml.includes('<pageSetUpPr')) {
      nextXml = nextXml.replace(/<sheetPr([^>]*)>/, '<sheetPr$1><pageSetUpPr fitToPage="1"/>');
    }
  } else {
    nextXml = nextXml.replace(/(<worksheet[^>]*>)/, '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
  }

  nextXml = nextXml
    .replace(/<printOptions\b[^/]*(?:\/>|>[\s\S]*?<\/printOptions>)/g, '')
    .replace(/<pageMargins\b[^/]*(?:\/>|>[\s\S]*?<\/pageMargins>)/g, '')
    .replace(/<pageSetup\b[^/]*(?:\/>|>[\s\S]*?<\/pageSetup>)/g, '');

  const printBlock = '<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';
  if (nextXml.includes('<ignoredErrors')) return nextXml.replace('<ignoredErrors', printBlock + '<ignoredErrors');
  return nextXml.replace('</worksheet>', printBlock + '</worksheet>');
}

function applyWorkbookPrintSettings(buffer: ArrayBuffer) {
  const zip = unzipSync(new Uint8Array(buffer));

  Object.keys(zip).forEach((path) => {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) return;
    zip[path] = strToU8(ensureWorksheetPrintSettings(strFromU8(zip[path])));
  });

  return zipSync(zip, { level: 6 });
}

function buildUserWeekRows(
  userTasks: ProcessedTask[],
  weekDays: WeekDayInfo[],
) {
  const tasksByDay = weekDays.map((day) => userTasks
    .filter((task) => taskOccursOnDay(task, day))
    .sort((left, right) => cleanCellText(left.title).localeCompare(cleanCellText(right.title), 'pt-BR'))
    .map((task) => cleanCellText(task.title))
  );
  const maxRows = Math.max(1, ...tasksByDay.map((items) => items.length));
  const rows = [weekDays.map((day) => day.label)];

  for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
    rows.push(tasksByDay.map((items) => items[rowIndex] || ''));
  }

  return rows;
}
export function WeeklyTaskScheduleView({ tasks, profiles, selectedUserIds, onView }: WeeklyTaskScheduleViewProps) {
  const weekDays = getCurrentWeekDays();
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const selectedUserSet = new Set(selectedUserIds);
  const scopedTasks = selectedUserIds.length > 0
    ? tasks.filter((task) => selectedUserSet.has(task.assigned_to))
    : tasks;
  const weekTasks = weekDays.flatMap((day) => scopedTasks.filter((task) => taskOccursOnDay(task, day)));
  const totalTasks = weekTasks.length;
  const activeUsers = new Set(weekTasks.map((task) => task.assigned_to).filter(Boolean));

  const exportSchedule = () => {
    if (weekTasks.length === 0) {
      alert('Nenhuma tarefa encontrada para exportar nesta semana.');
      return;
    }

    try {
      const workbook = XLSX.utils.book_new();
      const usedSheetNames = new Set<string>();
      const visibleUserIds = Array.from(new Set(weekTasks.map((task) => task.assigned_to).filter(Boolean)));

      visibleUserIds
        .sort((left, right) => {
          const leftName = profileById.get(left)?.full_name || 'Sem usuario';
          const rightName = profileById.get(right)?.full_name || 'Sem usuario';
          return leftName.localeCompare(rightName, 'pt-BR');
        })
        .forEach((userId, index) => {
          const profile = profileById.get(userId);
          const userName = profile?.full_name || 'Sem usuario';
          const userTasks = scopedTasks.filter((task) => task.assigned_to === userId);
          const rows = buildUserWeekRows(userTasks, weekDays);
          const worksheet = XLSX.utils.aoa_to_sheet(rows);

          applyScheduleSheetFormatting(worksheet, rows, weekDays);
          XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(userName, index + 1, usedSheetNames));
        });

      const userLabel = getExportUserLabel(selectedUserIds, visibleUserIds, profileById);
      const fileName = 'cronograma-' + fileSafeText(userLabel) + '-' + weekDays[0].date + '-' + weekDays[weekDays.length - 1].date + '-' + getExportTimeStamp() + '.xlsx';
      const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
      const formattedBuffer = applyWorkbookPrintSettings(buffer);
      const blob = new Blob([formattedBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Erro ao exportar cronograma semanal', error);
      alert('Nao foi possivel exportar o cronograma formatado. Tente novamente.');
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1760px] px-2 pt-8 sm:px-4">
      <section className="mb-4 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
              <CalendarDays size={24} />
            </span>
            <div>
              <h2 className="text-lg font-black uppercase italic tracking-tight text-slate-950">Cronograma semanal</h2>
              <p className="text-xs font-bold text-slate-500">Tarefas agrupadas por dia da semana e usuario responsavel.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-blue-50 px-3 py-2 text-[10px] font-black uppercase text-blue-700">{totalTasks} tarefas</span>
            <span className="rounded-full bg-slate-100 px-3 py-2 text-[10px] font-black uppercase text-slate-600">{activeUsers.size} usuarios</span>
            <button
              type="button"
              onClick={exportSchedule}
              className="inline-flex h-10 items-center gap-2 rounded-2xl bg-slate-950 px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-700"
            >
              <Download size={15} /> Exportar XLSX
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-5">
        {weekDays.map((day) => {
          const dayTasks = scopedTasks
            .filter((task) => taskOccursOnDay(task, day))
            .sort((left, right) => left.title.localeCompare(right.title, 'pt-BR'));

          return (
            <div key={day.id} className="flex min-h-[520px] flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 bg-slate-950 px-4 py-3 text-white">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-200">{day.shortLabel}</p>
                    <h3 className="text-base font-black uppercase italic">{day.label}</h3>
                  </div>
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-sm font-black text-slate-950">{day.dayNumber}</span>
                </div>
                <p className="mt-1 text-[10px] font-bold uppercase text-slate-300">{formatDateBR(day.date)} - {dayTasks.length} tarefa{dayTasks.length === 1 ? '' : 's'}</p>
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50/70 p-3">
                {dayTasks.length === 0 ? (
                  <div className="flex h-28 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white text-center text-[10px] font-black uppercase tracking-widest text-slate-300">
                    Sem tarefas neste dia
                  </div>
                ) : dayTasks.map((task) => {
                  const profile = profileById.get(task.assigned_to);
                  const status = getTaskStatusLabel(task, day.date);

                  return (
                    <button
                      key={`${day.id}-${task.id}`}
                      type="button"
                      onClick={() => onView(task)}
                      className="group w-full rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 text-xs font-black uppercase leading-snug text-slate-950 group-hover:text-blue-700">{task.title}</p>
                        {status === 'Concluida' ? <CheckCircle2 size={17} className="shrink-0 text-emerald-500" /> : <Clock size={17} className="shrink-0 text-slate-300" />}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <span className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase ${taskPriorityBadgeClassName(task.priority)}`}>{taskPriorityLabel(task.priority)}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black uppercase text-slate-500">{status}</span>
                        <span className="rounded-full bg-blue-50 px-2 py-1 text-[9px] font-black uppercase text-blue-700">{task.category}</span>
                      </div>
                      <div className="mt-3 flex items-center gap-2 text-[10px] font-black uppercase text-slate-500">
                        <UserRound size={13} className="text-slate-400" />
                        <span className="truncate">{profile?.full_name || 'Sem usuario'}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
