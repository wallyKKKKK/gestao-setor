'use client';

import * as XLSX from 'xlsx-js-style';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { useState } from 'react';
import { CalendarDays, CalendarArrowUp, CheckCircle2, ChevronLeft, ChevronRight, Clock, Download, UserRound } from 'lucide-react';
import { getTaskCardTone, taskCardSurfaceClass, taskCardToneClasses } from '@/lib/task-card-tone';
import { taskPriorityBadgeClassName, taskPriorityLabel } from '@/lib/task-priority';
import { monthlyWeekdayOccursOnDate, parseMonthlyWeekdayRepeats } from '@/lib/task-recurrence';
import { weeklyTaskAdvanceBlockedReason } from '@/lib/task-selectors';
import type { ProcessedTask, Profile } from '@/lib/types';

interface WeeklyTaskScheduleViewProps {
  tasks: ProcessedTask[];
  profiles: Profile[];
  selectedUserIds: string[];
  onView: (task: ProcessedTask) => void;
  onAdvance: (task: ProcessedTask) => void;
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
  { id: 'ter', label: 'Terça', shortLabel: 'TER' },
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

function getCurrentWeekDays(today = new Date()): WeekDayInfo[] {
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
  if (task.created_at.slice(0, 10) > day.date) return false;

  const repeatDays = task.repeat_days || '';
  if (!repeatDays) return false;

  if (parseMonthlyWeekdayRepeats(repeatDays).length) {
    return monthlyWeekdayOccursOnDate(repeatDays, day.date, task.repeat_interval || 1, task.created_at);
  }

  const weeklyDays = repeatDays.split(',');
  if (weeklyDays.includes(day.id)) return isWeeklyIntervalWeek(task, day.date);

  return task.lastOcc === day.date || dateFromBR(task.nextOcc) === day.date;
}

function getTaskStatusLabel(task: ProcessedTask, date: string) {
  if (task.last_done_date && task.last_done_date >= date) return 'Concluida';
  if (task.lastOcc === date && task.workflow_status === 'em_andamento') return 'Em andamento';
  if (task.lastOcc === date && task.workflow_status === 'bloqueada') return 'Bloqueada';
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
export function WeeklyTaskScheduleView({ tasks, profiles, selectedUserIds, onView, onAdvance }: WeeklyTaskScheduleViewProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const weekLabel = weekOffset === 0 ? 'Esta semana'
    : weekOffset === -1 ? 'Semana anterior'
      : weekOffset === 1 ? 'Próxima semana'
        : weekOffset < 0 ? `Há ${Math.abs(weekOffset)} semanas` : `Daqui a ${weekOffset} semanas`;
  const referenceDate = new Date();
  referenceDate.setDate(referenceDate.getDate() + weekOffset * 7);
  const weekDays = getCurrentWeekDays(referenceDate);
  const today = toDateStr(new Date());
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
    <div className="flex min-h-0 w-full flex-1 flex-col pt-4">
      <header className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3 px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <CalendarDays size={22} className="shrink-0 text-blue-600" />
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Calendário semanal</h2>
            <p className="mt-0.5 text-xs text-slate-500">{formatDateBR(weekDays[0].date)} a {formatDateBR(weekDays[4].date)} · {totalTasks} {totalTasks === 1 ? 'tarefa' : 'tarefas'} · {activeUsers.size} {activeUsers.size === 1 ? 'usuário' : 'usuários'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button type="button" title="Semana anterior" aria-label="Semana anterior" onClick={() => setWeekOffset(current => current - 1)} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"><ChevronLeft size={18} /></button>
            <button type="button" aria-label="Voltar para a semana atual" title="Voltar para a semana atual" onClick={() => setWeekOffset(0)} className="h-9 min-w-[144px] rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">{weekLabel}</button>
            <button type="button" title="Próxima semana" aria-label="Próxima semana" onClick={() => setWeekOffset(current => current + 1)} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"><ChevronRight size={18} /></button>
          </div>
          <button type="button" onClick={exportSchedule} disabled={!totalTasks} className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"><Download size={15} /> Exportar XLSX</button>
        </div>
      </header>
      <section aria-label="Calendário de tarefas da semana" tabIndex={0} className="min-h-0 flex-1 overflow-auto overscroll-contain scroll-pt-20 rounded-lg border border-slate-200 bg-white">
        <div className="grid min-h-full min-w-[1000px] grid-cols-5 divide-x divide-slate-200">
          {weekDays.map(day => {
            const dayTasks = scopedTasks
              .filter(task => taskOccursOnDay(task, day))
              .sort((left, right) => left.title.localeCompare(right.title, 'pt-BR'));
            const isToday = day.date === today;
            return (
              <section key={day.id} aria-label={day.label + ' ' + formatDateBR(day.date)} className="min-w-0">
                <header className={'sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-3 ' + (isToday ? 'bg-blue-50' : 'bg-slate-50')}>
                  <div>
                    <h3 className={'text-base font-bold ' + (isToday ? 'text-blue-700' : 'text-slate-700')}>{day.label}</h3>
                    <p className="mt-1 text-xs text-slate-500">{dayTasks.length} tarefa{dayTasks.length === 1 ? '' : 's'}{isToday ? ' · Hoje' : ''}</p>
                  </div>
                  <span aria-current={isToday ? 'date' : undefined} className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-semibold ' + (isToday ? 'bg-blue-600 text-white' : 'text-slate-700')}>{day.dayNumber}</span>
                </header>
                <div className={'space-y-2 p-2.5 ' + (isToday ? 'bg-blue-50/30' : '')}>
                  {dayTasks.length === 0 ? <p className="px-2 py-8 text-center text-xs text-slate-400">Sem tarefas</p> : dayTasks.map(task => {
                    const profile = profileById.get(task.assigned_to);
                    const status = getTaskStatusLabel(task, day.date);
                    const done = status === 'Concluida';
                    const inProgress = status === 'Em andamento';
                    const tone = done ? 'done'
                      : status === 'Bloqueada' ? 'previous'
                      : task.lastOcc === day.date ? getTaskCardTone({ ...task, isDoneToday: false }, today)
                      : task.schedule_override_date === day.date ? task.schedule_override_type ?? 'default'
                      : 'default';
                    const strongFill = tone === 'done' || tone === 'late';
                    const advanceBlockedReason = weeklyTaskAdvanceBlockedReason(task, day.date, today);
                    return (
                      <div key={day.id + '-' + task.id} className={`relative rounded-md [--task-shadow-offset:2px] ${taskCardSurfaceClass} ${taskCardToneClasses[tone]} ${strongFill ? 'text-slate-950' : 'text-slate-900'}`}>
                      <button type="button" title={task.title} onClick={() => onView(task)} className={`block w-full rounded-md p-3 text-left transition hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-blue-600 ${!done ? 'pr-12' : ''}`}>
                        <p className="break-words text-[13px] font-semibold leading-snug">{task.title}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className={'inline-flex items-center gap-1 text-[11px] font-medium ' + (strongFill ? '' : inProgress ? 'text-blue-700' : 'text-slate-600')}>{done ? <CheckCircle2 size={12} /> : <Clock size={12} />}{done ? 'Concluída' : status}</span>
                          <span className={'rounded border px-1.5 py-0.5 text-[9px] font-semibold ' + taskPriorityBadgeClassName(task.priority)}>{taskPriorityLabel(task.priority)}</span>
                        </div>
                        <div className={`mt-2 flex min-w-0 items-center gap-1.5 text-[11px] ${strongFill ? '' : 'text-slate-600'}`}><UserRound size={12} className="shrink-0" /><span className="truncate">{profile?.full_name || 'Sem usuário'}</span></div>
                      </button>
                      {!done && (
                        <button type="button" title={advanceBlockedReason ?? 'Adiantar para hoje'} aria-label={advanceBlockedReason ?? `Adiantar ${task.title} para hoje`} disabled={Boolean(advanceBlockedReason)} onClick={() => onAdvance(task)} className="absolute right-2 top-2 inline-flex size-8 items-center justify-center rounded-md border border-orange-300 bg-orange-50 text-orange-800 transition enabled:hover:bg-orange-100 focus-visible:outline-2 focus-visible:outline-orange-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-200">
                          <CalendarArrowUp size={16} aria-hidden="true" />
                        </button>
                      )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}
