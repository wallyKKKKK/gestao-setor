'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCircle2, ChevronLeft, ChevronRight, Edit3, ExternalLink, MapPin, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { CreateMeetingInput } from '@/lib/api';
import { getAuthHeaders } from '@/lib/auth-headers';
import { getPermissionDeniedMessage } from '@/lib/permissions';
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from '@/lib/google-calendar';
import type { ProcessedTask, Profile } from '@/lib/types';
import { useMeetingCalendars } from '@/lib/use-meeting-calendars';
import { calendarEventTask, calendarForeground, googleEventKey } from '@/lib/meeting-calendars';
import { MeetingCalendarSidebar } from '@/app/components/meeting-calendar-sidebar';
import { googleCalendarRequestError, needsGoogleReconnect, showGoogleConnectAction } from '@/lib/google-calendar-client';
import { useGoogleCalendarEvents } from '@/lib/use-google-calendar-events';

interface MeetingCalendarViewProps {
  tasks: ProcessedTask[];
  profiles: Profile[];
  userSector: string;
  defaultAssignedTo: string;
  onDeleteTask: (taskId: string) => void;
  canDeleteMeetings: boolean;
  onToggleMeeting: (task: ProcessedTask) => void;
  onCreateMeeting: (meeting: CreateMeetingInput) => Promise<void>;
  onUpdateMeeting: (task: ProcessedTask, meeting: CreateMeetingInput) => Promise<void>;
}

const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const meetingEventToneClasses = ['yellow', 'amber', 'orange', 'red', 'pink', 'fuchsia', 'purple', 'violet', 'indigo', 'blue', 'cyan'] as const;
type MeetingEventTone = typeof meetingEventToneClasses[number];
const meetingEventFillClassNames: Record<string, string> = {
  yellow: 'bg-yellow-400 text-yellow-950 hover:bg-yellow-500',
  amber: 'bg-amber-400 text-amber-950 hover:bg-amber-500',
  orange: 'bg-orange-400 text-orange-950 hover:bg-orange-500',
  red: 'bg-red-600 text-white hover:bg-red-700',
  pink: 'bg-rose-600 text-white hover:bg-rose-700',
  fuchsia: 'bg-fuchsia-700 text-white hover:bg-fuchsia-800',
  purple: 'bg-purple-600 text-white hover:bg-purple-700',
  violet: 'bg-violet-600 text-white hover:bg-violet-700',
  indigo: 'bg-indigo-600 text-white hover:bg-indigo-700',
  blue: 'bg-blue-700 text-white hover:bg-blue-800',
  cyan: 'bg-cyan-700 text-white hover:bg-cyan-800',
  done: 'bg-emerald-700 text-white hover:bg-emerald-800',
  google: 'bg-sky-700 text-white hover:bg-sky-800',
};

function isMeetingEventTone(value: string): value is MeetingEventTone {
  return meetingEventToneClasses.includes(value as MeetingEventTone);
}

function getStableMeetingEventTone(value: string, index = 0) {
  const seed = Array.from(value).reduce((total, char) => total + char.charCodeAt(0), index);
  return meetingEventToneClasses[Math.abs(seed) % meetingEventToneClasses.length];
}

function randomMeetingEventTone() {
  return meetingEventToneClasses[Math.floor(Math.random() * meetingEventToneClasses.length)];
}

function toISODate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function BrazilianDateField({ value, min, onChange, label }: {
  value: string;
  min?: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const displayDate = value ? value.split('-').reverse().join('/') : 'DD/MM/AAAA';
  return (
    <div className="relative">
      <input
        type="date"
        lang="pt-BR"
        aria-label={label}
        value={value}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 text-sm font-black text-transparent outline-none transition focus:border-blue-600 [&::-webkit-datetime-edit]:opacity-0"
      />
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-4 right-10 flex items-center text-sm font-black text-slate-900">
        {displayDate}
      </span>
    </div>
  );
}

function monthLabel(date: Date) {
  return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function padTimePart(value: number) {
  return String(value).padStart(2, '0');
}

function getTimeSortValue(time: string) {
  const match = time.match(/^([0-9]{2}):([0-9]{2})$/);
  if (!match) return 24 * 60 + 999;

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 24 * 60 + 999;

  return hours * 60 + minutes;
}

function TimeDialPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [mode, setMode] = useState<'hour' | 'minute'>('hour');
  const [hourValue = '09', minuteValue = '00'] = value.split(':');
  const hour = Number.parseInt(hourValue, 10) || 0;
  const minute = Number.parseInt(minuteValue, 10) || 0;
  const values = mode === 'hour'
    ? Array.from({ length: 24 }, (_, index) => index)
    : Array.from({ length: 12 }, (_, index) => index * 5);
  const activeValue = mode === 'hour' ? hour : minute;
  const activePosition = mode === 'hour' ? activeValue % 12 : Math.floor(activeValue / 5);
  const selectedAngle = (activePosition / 12) * 360 - 90;
  const selectedRadius = mode === 'hour' && activeValue >= 12 ? 29 : 42;

  const selectValue = (nextValue: number) => {
    if (mode === 'hour') {
      onChange(`${padTimePart(nextValue)}:${padTimePart(minute)}`);
      setMode('minute');
      return;
    }

    onChange(`${padTimePart(hour)}:${padTimePart(nextValue)}`);
  };

  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-3 text-slate-900 shadow-[0_18px_50px_rgba(15,23,42,0.16)]">
      <p className="text-[10px] font-black uppercase tracking-[0.24em] text-blue-600">Selecione o horário</p>

      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <button
          type="button"
          onClick={() => setMode('hour')}
          className={`h-14 rounded-[18px] text-3xl font-black transition ${
            mode === 'hour' ? 'bg-blue-600 text-white shadow-[0_12px_28px_rgba(37,99,235,0.24)]' : 'bg-slate-50 text-slate-700 ring-1 ring-slate-200 hover:bg-blue-50'
          }`}
        >
          {padTimePart(hour)}
        </button>
        <span className="text-3xl font-black text-slate-400">:</span>
        <button
          type="button"
          onClick={() => setMode('minute')}
          className={`h-14 rounded-[18px] text-3xl font-black transition ${
            mode === 'minute' ? 'bg-blue-600 text-white shadow-[0_12px_28px_rgba(37,99,235,0.24)]' : 'bg-slate-50 text-slate-700 ring-1 ring-slate-200 hover:bg-blue-50'
          }`}
        >
          {padTimePart(minute)}
        </button>
      </div>

      <div className="mx-auto mt-3 flex aspect-square max-h-[245px] min-h-[220px] w-full max-w-[245px] items-center justify-center rounded-full bg-slate-50 ring-1 ring-slate-200">
        <div className="relative h-[88%] w-[88%] rounded-full">
          <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500" />
          <div
            className="absolute left-1/2 top-1/2 h-1 rounded-full bg-blue-500"
            style={{
              width: `${selectedRadius}%`,
              transform: `rotate(${selectedAngle}deg)`,
              transformOrigin: 'left center',
            }}
          />

          {values.map((item) => {
            const position = mode === 'hour' ? item % 12 : item / 5;
            const angle = (position / 12) * Math.PI * 2 - Math.PI / 2;
            const radius = mode === 'hour' && item >= 12 ? 29 : 42;
            const left = 50 + Math.cos(angle) * radius;
            const top = 50 + Math.sin(angle) * radius;
            const selected = item === activeValue;
            const innerHour = mode === 'hour' && item >= 12;

            return (
              <button
                key={item}
                type="button"
                onClick={() => selectValue(item)}
                className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-black transition ${
                  selected ? 'bg-blue-600 text-white shadow-[0_10px_24px_rgba(37,99,235,0.28)]' : 'text-slate-700 hover:bg-blue-50 hover:text-blue-700'
                } ${innerHour ? 'h-8 w-8 text-xs' : 'h-9 w-9 text-sm'}`}
                style={{ left: `${left}%`, top: `${top}%` }}
              >
                {padTimePart(item)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TimePickerField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-12 w-full items-center justify-between rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 text-left font-black text-slate-900 outline-none transition hover:border-blue-200 hover:bg-white focus:border-blue-600"
      >
        <span className="text-xl tabular-nums">{value}</span>
        <span className="rounded-full bg-blue-100 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-blue-700">
          Ajustar
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[80]" onMouseDown={() => setOpen(false)} />
          <div
            className="absolute left-0 top-[calc(100%+8px)] z-[90] w-[min(360px,calc(100vw-2rem))]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <TimeDialPicker value={value} onChange={onChange} />
          </div>
        </>
      )}
    </div>
  );
}

function addDaysToISODate(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  const nextDate = new Date(year, month - 1, day + days);
  return toISODate(nextDate);
}

function getISODateRange(startDate: string, endDate: string, maxDays = 370) {
  if (!startDate) return [];
  const safeEndDate = endDate && endDate >= startDate ? endDate : startDate;
  const dates: string[] = [];
  let cursor = startDate;

  while (cursor <= safeEndDate && dates.length < maxDays) {
    dates.push(cursor);
    cursor = addDaysToISODate(cursor, 1);
  }

  return dates;
}

function getMeetingFieldFromNotes(notes: string | null | undefined, label: string) {
  const match = notes?.match(new RegExp(`${label}:\\s*([^\\n]+)`, 'i'));
  return match?.[1] || '';
}

function getMeetingStartDateFromTask(task: ProcessedTask) {
  return task.due_date || task.nextOcc;
}

function getMeetingEndDateFromTask(task: ProcessedTask) {
  const startDate = getMeetingStartDateFromTask(task);
  const storedEndDate = getMeetingFieldFromNotes(task.notes, 'Data final');
  return storedEndDate && /^\d{4}-\d{2}-\d{2}$/.test(storedEndDate) && storedEndDate >= startDate
    ? storedEndDate
    : startDate;
}

function getGoogleEventStartDate(event: GoogleCalendarEvent) {
  return event.start?.date || event.start?.dateTime?.slice(0, 10) || '';
}

function getGoogleEventEndDate(event: GoogleCalendarEvent) {
  const startDate = getGoogleEventStartDate(event);
  if (!startDate) return '';

  const rawEndDate = event.end?.date || event.end?.dateTime?.slice(0, 10) || startDate;
  const endDate = event.end?.date ? addDaysToISODate(rawEndDate, -1) : rawEndDate;
  return endDate >= startDate ? endDate : startDate;
}

function formatDateRange(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  if (!endDate || endDate === startDate) return start;

  const end = new Date(`${endDate}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  return `${start} até ${end}`;
}

export function MeetingCalendarView({
  tasks: legacyTasks,
  profiles,
  userSector,
  defaultAssignedTo,
  onDeleteTask,
  canDeleteMeetings,
  onToggleMeeting,
  onCreateMeeting,
  onUpdateMeeting,
}: MeetingCalendarViewProps) {
  const [googleStatus, setGoogleStatus] = useState({ configured: false, connected: false });
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarListEntry[]>([]);
  const [googleStatusError, setGoogleStatusError] = useState('');
  const [googleListHealth, setGoogleListHealth] = useState({ error: '', reconnectRequired: false });
  const [refreshKey, setRefreshKey] = useState(0);
  const [hiddenCalendars, setHiddenCalendars] = useState<string[]>(() => {
    try { const value = JSON.parse(localStorage.getItem(`wally-calendar-hidden:${defaultAssignedTo}`) || '[]'); return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []; }
    catch { return []; }
  });
  const [meetingCalendarId, setMeetingCalendarId] = useState('');
  const [preferredCalendarId, setPreferredCalendarId] = useState('');
  const [googleCalendarId, setGoogleCalendarId] = useState('primary');
  const savingLock = useRef(false);
  const [syncGoogleCalendar, setSyncGoogleCalendar] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState(toISODate(new Date()));
  const [meetingEndDate, setMeetingEndDate] = useState(toISODate(new Date()));
  const [meetingTime, setMeetingTime] = useState('09:00');
  const [meetingMotive, setMeetingMotive] = useState('');
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingNotes, setMeetingNotes] = useState('');
  const [meetingAssignedTo, setMeetingAssignedTo] = useState(defaultAssignedTo);
  const [savingMeeting, setSavingMeeting] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<ProcessedTask | null>(null);
  const [selectedMeeting, setSelectedMeeting] = useState<ProcessedTask | null>(null);
  const local = useMeetingCalendars(defaultAssignedTo, visibleMonth, refreshKey);
  const googleData = useGoogleCalendarEvents(defaultAssignedTo, googleStatus.connected, googleCalendars, hiddenCalendars, visibleMonth, refreshKey);
  const rawGoogleEvents = googleData.events;
  const googleError = googleStatusError || googleListHealth.error || googleData.error;
  const googleReconnectRequired = googleListHealth.reconnectRequired || googleData.reconnectRequired;
  const calendarById = useMemo(() => new Map(local.calendars.map(calendar => [calendar.id, calendar])), [local.calendars]);
  const eventByTaskId = useMemo(() => new Map(local.events.map(event => [`calendar:${event.id}`, event])), [local.events]);
  const tasks = useMemo(() => [
    ...(hiddenCalendars.includes('legacy') ? [] : legacyTasks),
    ...local.events.flatMap(event => {
      const calendar = calendarById.get(event.calendar_id);
      return calendar && !hiddenCalendars.includes(`local:${calendar.id}`) ? [calendarEventTask(event, calendar)] : [];
    }),
  ], [legacyTasks, local.events, calendarById, hiddenCalendars]);
  const selectedCalendar = calendarById.get(meetingCalendarId);
  const currentProfile = profiles.find(profile => profile.id === defaultAssignedTo);
  const canManageMeeting = (task: ProcessedTask) => {
    const event = eventByTaskId.get(task.id);
    if (!event) return true;
    const calendar = calendarById.get(event.calendar_id);
    return Boolean(calendar && (calendar.owner_id === defaultAssignedTo || event.created_by === defaultAssignedTo || (calendar.visibility === 'sector' && (currentProfile?.role === 'admin' || (currentProfile?.role === 'gerente' && calendar.sector === userSector)))));
  };
  const canDeleteMeeting = (task: ProcessedTask) => eventByTaskId.has(task.id) ? canManageMeeting(task) : canDeleteMeetings;
  const googleCalendarById = useMemo(() => new Map(googleCalendars.map(calendar => [calendar.id, calendar])), [googleCalendars]);
  const googleEvents = useMemo(() => {
    const primary = googleCalendars.find(calendar => calendar.primary)?.id || 'primary';
    const linked = new Set(tasks.flatMap(task => task.google_event_id ? [googleEventKey(eventByTaskId.get(task.id)?.google_calendar_id || primary, task.google_event_id)] : []));
    return rawGoogleEvents.filter(event => !hiddenCalendars.includes(`google:${event.calendarId}`) && !linked.has(googleEventKey(event.calendarId, event.id)));
  }, [rawGoogleEvents, googleCalendars, tasks, eventByTaskId, hiddenCalendars]);
  const writableGoogleCalendars = googleCalendars.filter(calendar => ['owner', 'writer', 'writerWithoutPrivateAccess'].includes(calendar.accessRole));
  const canDeleteGoogleEvent = (event: GoogleCalendarEvent) => {
    const calendar = googleCalendarById.get(event.calendarId || 'primary');
    return calendar ? ['owner', 'writer', 'writerWithoutPrivateAccess'].includes(calendar.accessRole) : canDeleteMeetings;
  };
  const meetingStyle = (task: ProcessedTask) => {
    const event = eventByTaskId.get(task.id);
    const calendar = event && calendarById.get(event.calendar_id);
    return calendar && !task.isDoneToday ? { backgroundColor: calendar.color, color: calendarForeground(calendar.color) } : undefined;
  };
  const googleStyle = (event: GoogleCalendarEvent) => {
    const calendar = googleCalendarById.get(event.calendarId || 'primary');
    const color = calendar?.backgroundColor;
    return color && /^#[0-9a-f]{6}$/i.test(color) ? { backgroundColor: color, color: calendarForeground(color) } : undefined;
  };
  const deleteMeetingDeniedMessage = getPermissionDeniedMessage('excluir reunioes', 'managerOrAdmin');

  useEffect(() => {
    try { localStorage.setItem(`wally-calendar-hidden:${defaultAssignedTo}`, JSON.stringify(hiddenCalendars)); } catch { /* Visibility remains in memory. */ }
  }, [defaultAssignedTo, hiddenCalendars]);
  useEffect(() => {
    const refresh = () => setRefreshKey(value => value + 1);
    window.addEventListener('wally:app-refresh', refresh);
    return () => window.removeEventListener('wally:app-refresh', refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;

    getAuthHeaders()
      .then((headers) => fetch(`/api/google-calendar/status?userId=${defaultAssignedTo}`, { headers }))
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error('Falha ao verificar conexão'); return data; })
      .then((data) => {
        if (cancelled) return;
        setGoogleStatus({ configured: Boolean(data.configured), connected: Boolean(data.connected) });
        setGoogleStatusError('');
        setSyncGoogleCalendar(false);
        if (!data.connected) setGoogleCalendars([]);
      })
      .catch(() => {
        if (cancelled) return;
        setGoogleStatusError('Não foi possível verificar a conexão Google. Tente atualizar.');
      });

    return () => {
      cancelled = true;
    };
  }, [defaultAssignedTo, refreshKey]);

  useEffect(() => {
    if (!googleStatus.connected) return;
    let cancelled = false;
    getAuthHeaders().then(headers => fetch(`/api/google-calendar/calendars?userId=${defaultAssignedTo}`, { headers }))
      .then(async response => { const data = await response.json(); if (!response.ok) throw googleCalendarRequestError(data, 'Não foi possível listar as agendas Google.'); return data; })
      .then(data => { if (!cancelled) { setGoogleCalendars(data.calendars || []); setGoogleListHealth({ error: '', reconnectRequired: false }); const primary = (data.calendars as GoogleCalendarListEntry[]).find(calendar => calendar.primary); if (primary) setGoogleCalendarId(primary.id); } })
      .catch(error => { if (!cancelled) { setGoogleListHealth({ error: error.message, reconnectRequired: needsGoogleReconnect(error) }); } });
    return () => { cancelled = true; };
  }, [defaultAssignedTo, googleStatus.connected, refreshKey]);

  const days = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const cells: Array<Date | null> = [];

    for (let i = 0; i < firstDay.getDay(); i += 1) cells.push(null);
    for (let day = 1; day <= lastDay.getDate(); day += 1) cells.push(new Date(year, month, day));
    while (cells.length % 7 !== 0) cells.push(null);

    return cells;
  }, [visibleMonth]);
  const calendarWeekCount = Math.max(1, Math.ceil(days.length / 7));

  const tasksByDay = useMemo(() => {
    return tasks.reduce<Record<string, ProcessedTask[]>>((acc, task) => {
      const startDate = getMeetingStartDateFromTask(task);
      const endDate = getMeetingEndDateFromTask(task);

      getISODateRange(startDate, endDate).forEach((key) => {
        acc[key] = [...(acc[key] || []), task];
      });

      return acc;
    }, {});
  }, [tasks]);

  const monthTasks = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const monthStart = toISODate(new Date(year, month, 1));
    const monthEnd = toISODate(new Date(year, month + 1, 0));

    return tasks
      .filter((task) => {
        const startDate = getMeetingStartDateFromTask(task);
        const endDate = getMeetingEndDateFromTask(task);
        return startDate <= monthEnd && endDate >= monthStart;
      })
      .sort((a, b) => (
        getMeetingStartDateFromTask(a).localeCompare(getMeetingStartDateFromTask(b))
        || getTimeSortValue(getMeetingFieldFromNotes(a.notes, 'Horário') || '--:--') - getTimeSortValue(getMeetingFieldFromNotes(b.notes, 'Horário') || '--:--')
        || a.title.localeCompare(b.title)
      ));
  }, [tasks, visibleMonth]);
  const completedMonthTasks = useMemo(() => monthTasks.filter((task) => task.isDoneToday).length, [monthTasks]);
  const selectedMeetingDetails = useMemo(() => (
    selectedMeeting ? tasks.find((task) => task.id === selectedMeeting.id) || selectedMeeting : null
  ), [selectedMeeting, tasks]);

  const googleEventsByDay = useMemo(() => {
    return googleEvents.reduce<Record<string, GoogleCalendarEvent[]>>((acc, event) => {
      const startDate = getGoogleEventStartDate(event);
      const endDate = getGoogleEventEndDate(event);
      if (!startDate) return acc;

      getISODateRange(startDate, endDate).forEach((key) => {
        acc[key] = [...(acc[key] || []), event];
      });

      return acc;
    }, {});
  }, [googleEvents]);

  const getGoogleEventTime = (event: GoogleCalendarEvent) => {
    if (event.start?.date) return 'Dia todo';
    return event.start?.dateTime?.slice(11, 16) || '--:--';
  };

  const getAssigneeName = useCallback((task: ProcessedTask) => (
    profiles.find((profile) => profile.id === task.assigned_to)?.full_name || 'Sem responsável'
  ), [profiles]);

  const handleGoogleReconnectRequired = useCallback((message?: string) => {
    setGoogleStatus((current) => ({ ...current, connected: false }));
    setSyncGoogleCalendar(false);
    alert(message || 'Sua conexão com o Google Calendar expirou. Conecte novamente.');
  }, []);

  const getMeetingTime = (task: ProcessedTask) => {
    const match = task.notes?.match(/Horário:\s*([0-9]{2}:[0-9]{2})/i);
    return match?.[1] || '--:--';
  };

  const getStoredMeetingTone = (task: ProcessedTask) => {
    const match = task.notes?.match(/Cor:\s*([a-z-]+)/i);
    const tone = match?.[1]?.toLowerCase() || '';
    if (tone === 'emerald' || tone === 'green') return 'cyan';
    return isMeetingEventTone(tone) ? tone : '';
  };

  const getMeetingEventTone = (task: ProcessedTask, index: number) => {
    if (isMeetingCompleted(task)) return 'done';
    const storedTone = getStoredMeetingTone(task);
    if (storedTone) return storedTone;

    return getStableMeetingEventTone(task.id || task.title, index);
  };

  const isMeetingCompleted = (task: ProcessedTask) => task.isDoneToday;

  const getMeetingField = (task: ProcessedTask, label: string) => getMeetingFieldFromNotes(task.notes, label);

  const getMeetingStartDate = (task: ProcessedTask) => getMeetingStartDateFromTask(task);

  const getMeetingEndDate = (task: ProcessedTask) => getMeetingEndDateFromTask(task);


  const resetMeetingForm = useCallback(() => {
    setMeetingTitle('');
    setMeetingDate(toISODate(new Date()));
    setMeetingEndDate(toISODate(new Date()));
    setMeetingTime('09:00');
    setMeetingMotive('');
    setMeetingLocation('');
    setMeetingNotes('');
    setMeetingAssignedTo(defaultAssignedTo);
    setMeetingCalendarId(preferredCalendarId);
    setSyncGoogleCalendar(false);
    setEditingMeeting(null);
  }, [defaultAssignedTo, preferredCalendarId]);

  const openCreateMeeting = useCallback((date = new Date()) => {
    resetMeetingForm();
    const selectedDate = toISODate(date);
    setMeetingDate(selectedDate);
    setMeetingEndDate(selectedDate);
    setShowCreateModal(true);
  }, [resetMeetingForm]);

  useEffect(() => {
    if (!showCreateModal) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowCreateModal(false);
        resetMeetingForm();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [resetMeetingForm, showCreateModal]);

  useEffect(() => {
    if (!selectedMeeting) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedMeeting(null);
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [selectedMeeting]);

  const openEditMeeting = (task: ProcessedTask) => {
    if (!canManageMeeting(task)) return;
    setEditingMeeting(task);
    setMeetingTitle(task.title);
    const startDate = task.due_date || task.nextOcc || toISODate(new Date());
    setMeetingDate(startDate);
    setMeetingEndDate(getMeetingEndDateFromTask(task));
    setMeetingTime(getMeetingTime(task) === '--:--' ? '09:00' : getMeetingTime(task));
    setMeetingMotive(getMeetingField(task, 'Motivo'));
    setMeetingLocation(getMeetingField(task, 'Local'));
    setMeetingNotes(getMeetingField(task, 'Observações'));
    setMeetingAssignedTo(task.assigned_to);
    setMeetingCalendarId(eventByTaskId.get(task.id)?.calendar_id || '');
    setSyncGoogleCalendar(false);
    setShowCreateModal(true);
  };

  const submitMeeting = async () => {
    if (savingLock.current) return;
    if (!meetingTitle || !meetingDate || !meetingEndDate || !meetingTime || !meetingAssignedTo) {
      alert('Preencha titulo, data inicial, data final, hora e responsavel.');
      return;
    }

    if (meetingEndDate < meetingDate) {
      alert('A data final nao pode ser anterior a data inicial.');
      return;
    }

    if (selectedCalendar?.visibility === 'personal' && meetingAssignedTo !== defaultAssignedTo) { alert('Eventos pessoais devem ficar atribuídos a você.'); return; }
    savingLock.current = true;
    setSavingMeeting(true);
    try {
      const meeting = {
        title: meetingTitle,
        date: meetingDate,
        endDate: meetingEndDate,
        time: meetingTime,
        motive: meetingMotive,
        location: meetingLocation,
        notes: meetingNotes,
        assignedTo: meetingAssignedTo,
        sector: selectedCalendar?.sector || userSector,
        tone: editingMeeting ? getStoredMeetingTone(editingMeeting) || randomMeetingEventTone() : randomMeetingEventTone(),
      };
      let googleEvent: { id?: string; htmlLink?: string } | null = null;

      if (!editingMeeting && syncGoogleCalendar && googleStatus.connected) {
        const response = await fetch('/api/google-calendar/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...await getAuthHeaders() },
          body: JSON.stringify({ userId: defaultAssignedTo, meeting, calendarId: googleCalendarId }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => null);
          if (data?.reconnectRequired) {
            handleGoogleReconnectRequired(data.error);
            return;
          }
          alert(data?.error || 'Não foi possível enviar ao Google Calendar.');
          return;
        }

        const data = await response.json();
        googleEvent = data.event || null;
        googleData.invalidate();
      }

      if (meetingCalendarId) {
        await local.saveEvent(editingMeeting ? eventByTaskId.get(editingMeeting.id)?.id || null : null, {
          calendar_id: meetingCalendarId, title: meeting.title, start_date: meeting.date, end_date: meeting.endDate,
          time: meeting.time, location: meeting.location, notes: meeting.notes, assigned_to: meeting.assignedTo,
          google_event_id: googleEvent?.id || null, google_calendar_id: googleCalendarId, google_event_link: googleEvent?.htmlLink || null,
        });
      } else if (editingMeeting) {
        await onUpdateMeeting(editingMeeting, meeting);
      } else {
        await onCreateMeeting({
          ...meeting,
          googleEventId: googleEvent?.id || null,
          googleEventLink: googleEvent?.htmlLink || null,
        });
      }

      resetMeetingForm();
      setShowCreateModal(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Não foi possível salvar o evento.');
    } finally {
      savingLock.current = false;
      setSavingMeeting(false);
    }
  };

  const deleteGoogleEvent = async (event: GoogleCalendarEvent) => {
    if (!canDeleteGoogleEvent(event)) {
      alert(deleteMeetingDeniedMessage);
      return;
    }
    if (!confirm(`Excluir "${event.summary || 'Evento Google'}" do Google Calendar?`)) return;

    const response = await fetch(`/api/google-calendar/events?userId=${defaultAssignedTo}&eventId=${encodeURIComponent(event.id)}&calendarId=${encodeURIComponent(event.calendarId || 'primary')}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      if (data?.reconnectRequired) {
        handleGoogleReconnectRequired(data.error);
        return;
      }
      alert(data?.error || 'Não foi possível excluir o evento do Google Calendar.');
      return;
    }

    googleData.remove(event.calendarId || 'primary', event.id);
  };

  const toggleMeeting = async (task: ProcessedTask) => {
    if (!canManageMeeting(task)) return;
    const event = eventByTaskId.get(task.id);
    try { if (event) await local.toggleEvent(event); else onToggleMeeting(task); }
    catch (error) { alert(error instanceof Error ? error.message : 'Não foi possível atualizar o evento.'); }
  };

  const removeMeeting = async (task: ProcessedTask) => {
    if (!canDeleteMeeting(task)) return;
    const event = eventByTaskId.get(task.id);
    if (!event) { onDeleteTask(task.id); setSelectedMeeting(null); return; }
    if (!confirm(`Excluir o evento "${task.title}" desta agenda do app?`)) return;
    try { await local.deleteEvent(event.id); setSelectedMeeting(null); }
    catch (error) { alert(error instanceof Error ? error.message : 'Não foi possível excluir o evento.'); }
  };

  const connectGoogle = () => {
    getAuthHeaders()
      .then((headers) => fetch('/api/google-calendar/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ userId: defaultAssignedTo }),
      }))
      .then((response) => response.ok ? response.json() : Promise.reject(response))
      .then((data) => {
        if (data?.url) window.location.href = data.url;
      })
      .catch(() => alert('Não foi possível iniciar a conexão com o Google Calendar.'));
  };

  return (
    <main className="mx-auto flex h-[calc(100dvh-5rem)] max-w-[1760px] flex-col overflow-hidden px-2 py-2 pb-20 sm:h-[calc(100dvh-4rem)] sm:px-4 sm:pb-2">

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden md:flex-row">
        <MeetingCalendarSidebar userId={defaultAssignedTo} sector={userSector} calendars={local.calendars} googleCalendars={googleCalendars}
          hidden={hiddenCalendars} onToggle={key => setHiddenCalendars(current => current.includes(key) ? current.filter(value => value !== key) : [...current, key])}
          loading={local.loading} googleConnected={googleStatus.connected} googleConfigured={googleStatus.configured} googleReconnectRequired={googleReconnectRequired} googleError={googleError}
          onConnect={connectGoogle} onRefresh={() => setRefreshKey(value => value + 1)}
          onCreate={async (name, color, visibility) => { const calendar = await local.createCalendar(name, color, visibility, userSector); setPreferredCalendarId(calendar.id); setHiddenCalendars(current => current.filter(key => key !== `local:${calendar.id}`)); }} />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
        {local.error && <p role="alert" className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">{local.error}</p>}
        <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold capitalize text-slate-900 sm:text-xl">
                {monthLabel(visibleMonth)}
              </h2>
              <p className="mt-1 truncate text-xs font-medium text-slate-500">
                {monthTasks.length} {monthTasks.length === 1 ? 'reunião' : 'reuniões'}
                {monthTasks.length > 0 ? ` - ${completedMonthTasks} concluída${completedMonthTasks === 1 ? '' : 's'}` : ''}
                {googleStatus.connected ? ` - ${googleEvents.length} evento${googleEvents.length === 1 ? '' : 's'} Google` : ''}
                {googleData.loading && !googleData.error && <span role="status" className="ml-2 text-slate-400">Carregando eventos...</span>}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <button onClick={() => openCreateMeeting()} className="flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-700">
                <Plus size={15} /> Nova reunião
              </button>
              {showGoogleConnectAction(googleStatus.configured, googleStatus.connected, googleReconnectRequired) ? (
                <button
                  onClick={connectGoogle}
                  className={`h-8 rounded-lg border px-3 text-[9px] font-black uppercase tracking-widest shadow-sm transition ${
                    googleStatus.connected ? 'border-green-200 bg-green-100 text-green-700' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'
                  }`}
                >
                  {googleStatus.connected ? 'Reconectar Google' : 'Conectar Google'}
                </button>
              ) : googleStatus.connected ? <span className="rounded-lg border border-green-200 bg-green-100 px-3 py-2 text-[9px] font-bold uppercase text-green-700">{googleError ? 'Google indisponível' : 'Google conectado'}</span> : null}
              <button title="Mês anterior" aria-label="Mês anterior" onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white transition hover:bg-slate-50">
                <ChevronLeft size={17} />
              </button>
              <button onClick={() => {
                const now = new Date();
                setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1));
              }} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
                Hoje
              </button>
              <button title="Próximo mês" aria-label="Próximo mês" onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white transition hover:bg-slate-50">
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        </div>

        <div className="hidden shrink-0 grid-cols-7 border-b border-slate-200 bg-white text-slate-500 md:grid">
          {weekDays.map((day) => (
            <div key={day} className="px-3 py-2 text-right text-base font-bold">
              {day}
            </div>
          ))}
        </div>

        <div
          className="hidden min-h-0 flex-1 grid-cols-7 gap-px bg-slate-200 md:grid"
          style={{ gridTemplateRows: `repeat(${calendarWeekCount}, minmax(0, 1fr))` }}
        >
          {days.map((day, index) => {
            const key = day ? toISODate(day) : `empty-${index}`;
            const dayKey = day ? toISODate(day) : '';
            const dayTasks = day ? tasksByDay[dayKey] || [] : [];
            const dayGoogleEvents = day ? googleEventsByDay[dayKey] || [] : [];
            const isToday = day && toISODate(day) === toISODate(new Date());
            const calendarItems = day
              ? [
                ...dayTasks.map((task) => ({
                  id: `task:${task.id}`,
                  type: 'task' as const,
                  task,
                  time: getMeetingTime(task),
                  rangeStart: getMeetingStartDate(task),
                  rangeEnd: getMeetingEndDate(task),
                  sortValue: getTimeSortValue(getMeetingTime(task)),
                })),
                ...dayGoogleEvents.map((event) => ({
                  id: `google:${googleEventKey(event.calendarId, event.id)}`,
                  type: 'google' as const,
                  event,
                  time: getGoogleEventTime(event),
                  rangeStart: getGoogleEventStartDate(event),
                  rangeEnd: getGoogleEventEndDate(event),
                  sortValue: getTimeSortValue(getGoogleEventTime(event)),
                })),
              ].sort((left, right) => left.sortValue - right.sortValue || left.id.localeCompare(right.id))
              : [];
            return (
              <div
                key={key}
                onClick={day ? () => openCreateMeeting(day) : undefined}
                onKeyDown={day ? (event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openCreateMeeting(day);
                  }
                } : undefined}
                role={day ? 'button' : undefined}
                tabIndex={day ? 0 : undefined}
                title={day ? 'Clique para agendar uma reuniao neste dia' : undefined}
                className={`relative flex min-h-0 flex-col overflow-hidden p-1.5 transition ${
                  day
                    ? 'cursor-pointer bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-300'
                    : 'bg-slate-50'
                }`}
              >
                {day && (
                  <>
                    {calendarItems.length > 0 && (
                      <div className="-mx-1.5 mt-7 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                        {calendarItems.map((item, itemIndex) => {
                          const tone = item.type === 'task'
                            ? getMeetingEventTone(item.task, itemIndex)
                            : getStableMeetingEventTone(item.event.id || item.event.summary || item.id, itemIndex);
                          const fillClassName = meetingEventFillClassNames[tone] || meetingEventFillClassNames.blue;
                          const isRangeEvent = item.rangeEnd > item.rangeStart;
                          const shouldShowRangeLabel = !isRangeEvent || dayKey === item.rangeStart || day?.getDay() === 0;
                          const rangeShape = isRangeEvent
                            ? `${dayKey === item.rangeStart || day.getDay() === 0 ? 'ml-1.5 rounded-l' : ''} ${dayKey === item.rangeEnd || day.getDay() === 6 ? 'mr-1.5 rounded-r' : ''}`
                            : 'mx-1.5 rounded';

                          if (item.type === 'google') {
                            return (
                              <div
                                key={item.id}
                                onClick={(clickEvent) => clickEvent.stopPropagation()}
                                title={`${item.time} ${item.event.summary || 'Evento Google'}`}
                                style={googleStyle(item.event)}
                                className={`flex h-6 min-h-6 min-w-0 shrink-0 items-center gap-1.5 px-1.5 text-left text-[11px] font-medium transition ${rangeShape} ${googleStyle(item.event) ? '' : fillClassName}`}
                              >
                                <a href={item.event.htmlLink} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-1.5">
                                  <span className="shrink-0 tabular-nums opacity-85">{shouldShowRangeLabel ? item.time : ''}</span>
                                  <span className="min-w-0 flex-1 truncate">{item.event.summary || 'Evento Google'}</span>
                                </a>
                                <button
                                  onClick={(clickEvent) => {
                                    clickEvent.stopPropagation();
                                    deleteGoogleEvent(item.event);
                                  }}
                                  disabled={!canDeleteGoogleEvent(item.event)}
                                  className={`shrink-0 transition ${canDeleteGoogleEvent(item.event) ? 'opacity-80 hover:opacity-100' : 'cursor-not-allowed opacity-40'}`}
                                  title={canDeleteGoogleEvent(item.event) ? 'Excluir evento Google' : 'Esta agenda Google é somente leitura.'}
                                  aria-label="Excluir evento Google"
                                  aria-disabled={!canDeleteGoogleEvent(item.event)}
                                >
                                  <Trash2 size={10} />
                                </button>
                              </div>
                            );
                          }

                          const completed = isMeetingCompleted(item.task);

                          return (
                            <button
                              key={item.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedMeeting(item.task);
                              }}
                              title={`${item.time} ${item.task.title}`}
                              style={meetingStyle(item.task)}
                              className={`flex h-6 min-h-6 min-w-0 shrink-0 items-center gap-1.5 px-1.5 text-left text-[11px] font-medium transition ${rangeShape} ${meetingStyle(item.task) ? '' : fillClassName}`}
                            >
                              <span className="shrink-0 tabular-nums opacity-85">{shouldShowRangeLabel ? item.time : ''}</span>
                              <span className={`min-w-0 flex-1 truncate ${completed ? 'opacity-70' : ''}`}>
                                {item.task.title}
                              </span>
                              {completed && (
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-700/10">
                                  <Check size={13} strokeWidth={3} />
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className={`absolute right-1.5 top-1 z-20 flex h-6 w-6 items-center justify-center rounded-full text-base font-semibold ${
                      isToday ? 'bg-blue-600 text-white' : 'text-slate-600'
                    }`}>
                      {day.getDate()}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto md:hidden">
          {monthTasks.length === 0 && googleEvents.length === 0 ? (
            <div className="flex min-h-[260px] items-center justify-center p-8 text-center text-xs font-black uppercase tracking-widest text-slate-300">
              Nenhuma reunião neste mês
            </div>
          ) : (
            <>
            {monthTasks.map((task) => {
              const completed = isMeetingCompleted(task);

              return (
              <div key={task.id} className={`flex w-full gap-3 p-4 transition-all ${completed ? 'bg-emerald-50/70 hover:bg-emerald-50' : 'hover:bg-blue-50'}`}>
                <div style={meetingStyle(task)} className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-md ${completed ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-700'}`}>
                  <span className="text-lg font-semibold">{new Date(`${getMeetingStartDate(task)}T00:00:00`).getDate()}</span>
                  <span className="text-[10px] font-medium">
                    {new Date(`${getMeetingStartDate(task)}T00:00:00`).toLocaleDateString('pt-BR', { month: 'short' })}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <button onClick={() => setSelectedMeeting(task)} className="block w-full text-left">
                    <div className="flex items-start gap-2">
                      <h3 className={`line-clamp-2 text-sm font-semibold leading-snug ${completed ? 'text-emerald-800/65' : 'text-slate-900'}`}>{task.title}</h3>
                      {completed && <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />}
                    </div>
                  </button>
                  <p className={`mt-1 truncate text-xs font-medium ${completed ? 'text-emerald-600/70' : 'text-slate-500'}`}>
                    {getMeetingTime(task)} • {getAssigneeName(task)}
                  </p>
                  {getMeetingEndDate(task) > getMeetingStartDate(task) && (
                    <p className="mt-1 text-xs text-slate-500">Até {new Date(`${getMeetingEndDate(task)}T00:00:00`).toLocaleDateString('pt-BR')}</p>
                  )}
                </div>
              </div>
              );
            })}
            {googleEvents.map((event) => {
              const eventDate = event.start?.date || event.start?.dateTime?.slice(0, 10) || toISODate(new Date());

              return (
                <div key={googleEventKey(event.calendarId, event.id)} className="flex w-full gap-3 p-4 text-left transition-all hover:bg-green-50">
                  <div style={{ backgroundColor: googleCalendarById.get(event.calendarId || 'primary')?.backgroundColor || '#16a34a', color: calendarForeground(googleCalendarById.get(event.calendarId || 'primary')?.backgroundColor || '#16a34a') }} className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-green-600 text-white">
                    <span className="text-lg font-black">{new Date(`${eventDate}T00:00:00`).getDate()}</span>
                    <span className="text-[8px] font-black uppercase">
                      {new Date(`${eventDate}T00:00:00`).toLocaleDateString('pt-BR', { month: 'short' })}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[8px] font-black uppercase text-green-600 mb-1">{googleCalendarById.get(event.calendarId || 'primary')?.summary || 'Google Calendar'}</div>
                    <a href={event.htmlLink} target="_blank" rel="noreferrer" className="inline-flex items-start gap-2">
                      <h3 className="line-clamp-2 text-sm font-black uppercase leading-tight text-slate-900">{event.summary || 'Evento Google'}</h3>
                      <ExternalLink size={14} className="text-green-600 shrink-0 mt-0.5" />
                    </a>
                    <p className="text-[10px] font-bold uppercase text-slate-400 mt-1">
                      {getGoogleEventTime(event)} {event.location ? `• ${event.location}` : ''}
                    </p>
                    <button
                      onClick={() => deleteGoogleEvent(event)}
                      disabled={!canDeleteGoogleEvent(event)}
                      className={`mt-3 flex items-center gap-1 text-[10px] font-black uppercase ${canDeleteGoogleEvent(event) ? 'text-red-500' : 'cursor-not-allowed text-slate-300 opacity-60'}`}
                      title={canDeleteGoogleEvent(event) ? 'Excluir evento Google' : 'Agenda somente leitura'}
                      aria-disabled={!canDeleteGoogleEvent(event)}
                    >
                      <Trash2 size={12} /> Excluir do Google
                    </button>
                  </div>
                </div>
              );
            })}
            </>
          )}
        </div>
        </div>
      </div>

      {selectedMeetingDetails && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/16 p-4 backdrop-blur-sm"
          onMouseDown={() => setSelectedMeeting(null)}
        >
          <div
            className="max-h-[calc(100dvh-2rem)] w-full max-w-[740px] overflow-y-auto rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
              <div className="min-w-0 flex-1">
                <div className="mb-3 flex items-center gap-2">
                  <span className={`h-3 w-3 rounded-full ${isMeetingCompleted(selectedMeetingDetails) ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    {isMeetingCompleted(selectedMeetingDetails) ? 'Reunião concluída' : 'Reunião agendada'}
                  </span>
                </div>
                <h2 className="text-2xl font-black uppercase tracking-tight text-slate-950">
                  {selectedMeetingDetails.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMeeting(null)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
                aria-label="Fechar detalhes da reunião"
              >
                <X size={21} />
              </button>
            </div>

            <div className="grid gap-5 px-6 py-5 md:grid-cols-[1fr_260px]">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-bold text-slate-600">
                  <span>{formatDateRange(getMeetingStartDate(selectedMeetingDetails), getMeetingEndDate(selectedMeetingDetails))}</span>
                  <span className="text-slate-300">-</span>
                  <span>{getMeetingTime(selectedMeetingDetails)}</span>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Responsável</p>
                      <p className="mt-1 text-sm font-black uppercase text-slate-800">{getAssigneeName(selectedMeetingDetails)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Localização</p>
                      <p className="mt-1 text-sm font-black uppercase text-slate-800">{getMeetingField(selectedMeetingDetails, 'Local') || 'Não informado'}</p>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Motivo</p>
                  <p className="mt-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm font-bold leading-relaxed text-slate-700">
                    {getMeetingField(selectedMeetingDetails, 'Motivo') || 'Sem motivo informado.'}
                  </p>
                </div>

                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Observações</p>
                  <p className="mt-2 min-h-20 rounded-2xl border border-slate-200 bg-white p-4 text-sm font-bold leading-relaxed text-slate-700 whitespace-pre-wrap">
                    {getMeetingField(selectedMeetingDetails, 'Observacoes') || getMeetingField(selectedMeetingDetails, 'Observações') || 'Sem observações adicionais.'}
                  </p>
                </div>
              </div>

              <div className="flex flex-col justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void toggleMeeting(selectedMeetingDetails)}
                  disabled={!canManageMeeting(selectedMeetingDetails)}
                  className={`inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-4 text-[11px] font-black uppercase tracking-widest ${
                    isMeetingCompleted(selectedMeetingDetails)
                      ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      : 'bg-emerald-600 text-white hover:bg-emerald-700'
                  }`}
                >
                  {isMeetingCompleted(selectedMeetingDetails) ? <RotateCcw size={16} /> : <CheckCircle2 size={16} />}
                  {isMeetingCompleted(selectedMeetingDetails) ? 'Reabrir' : 'Concluir'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const meeting = selectedMeetingDetails;
                    setSelectedMeeting(null);
                    openEditMeeting(meeting);
                  }}
                  disabled={!canManageMeeting(selectedMeetingDetails)}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-[11px] font-black uppercase tracking-widest text-slate-700 hover:border-blue-300 hover:text-blue-600 disabled:opacity-40"
                >
                  <Edit3 size={16} /> Editar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!canDeleteMeeting(selectedMeetingDetails)) {
                      alert(deleteMeetingDeniedMessage);
                      return;
                    }
                    void removeMeeting(selectedMeetingDetails);
                  }}
                  title={canDeleteMeeting(selectedMeetingDetails) ? 'Excluir reunião do app' : deleteMeetingDeniedMessage}
                  disabled={!canDeleteMeeting(selectedMeetingDetails)}
                  aria-disabled={!canDeleteMeeting(selectedMeetingDetails)}
                  className={`inline-flex h-12 items-center justify-center gap-2 rounded-2xl border px-4 text-[11px] font-black uppercase tracking-widest ${
                    canDeleteMeeting(selectedMeetingDetails)
                      ? 'border-red-100 bg-red-50 text-red-600 hover:bg-red-100'
                      : 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300 opacity-70'
                  }`}
                >
                  <Trash2 size={16} /> Excluir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/16 p-3 backdrop-blur-sm">
          <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl overflow-y-auto rounded-[30px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
            <div className="flex items-center justify-between border-b-2 border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-xl font-black uppercase italic tracking-tighter">{editingMeeting ? 'Editar reunião' : 'Agendar reunião'}</h2>
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">{editingMeeting ? 'Atualizar compromisso da agenda' : 'Novo compromisso da agenda'}</p>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 transition hover:bg-slate-200">
                <X size={21} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1 sm:col-span-2 lg:col-span-4">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Agenda</span>
                <select aria-label="Agenda do evento" value={meetingCalendarId} disabled={Boolean(editingMeeting)} onChange={event => {
                  const id = event.target.value;
                  const calendar = calendarById.get(id);
                  setMeetingCalendarId(id);
                  setPreferredCalendarId(id);
                  setSyncGoogleCalendar(false);
                  setMeetingAssignedTo(calendar?.visibility === 'personal' ? defaultAssignedTo : profiles.find(profile => profile.id === defaultAssignedTo && (!calendar || profile.sector === calendar.sector))?.id || profiles.find(profile => profile.sector === calendar?.sector)?.id || defaultAssignedTo);
                }} className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm disabled:opacity-70">
                  <option value="">Agenda do setor (compromissos atuais)</option>
                  {local.calendars.map(calendar => <option key={calendar.id} value={calendar.id} disabled={calendar.owner_id !== defaultAssignedTo && calendar.sector !== userSector}>{calendar.name} · {calendar.visibility === 'personal' ? 'Pessoal' : `Setor ${calendar.sector}`}</option>)}
                </select>
              </label>
              <label className="sm:col-span-2 space-y-1">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Título</span>
                <input value={meetingTitle} onChange={(event) => setMeetingTitle(event.target.value)} className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 text-sm font-black uppercase outline-none transition focus:border-blue-600" placeholder="Ex: Alinhamento comercial" />
              </label>

              <label className="space-y-1">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Data inicial</span>
                <BrazilianDateField label="Data inicial" value={meetingDate} onChange={(nextDate) => {
                  setMeetingDate(nextDate);
                  if (meetingEndDate < nextDate) setMeetingEndDate(nextDate);
                }} />
              </label>

              <label className="space-y-1">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Data final</span>
                <BrazilianDateField label="Data final" value={meetingEndDate} min={meetingDate} onChange={setMeetingEndDate} />
              </label>

              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Hora</span>
                <TimePickerField value={meetingTime} onChange={setMeetingTime} />
              </div>

              {editingMeeting && <label className="space-y-1 sm:col-span-2 lg:col-span-4">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Motivo</span>
                <input value={meetingMotive} onChange={(event) => setMeetingMotive(event.target.value)} className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 text-sm font-bold outline-none transition focus:border-blue-600" placeholder="Ex: Definir prioridades da semana" />
              </label>}

              <label className="space-y-1 sm:col-span-1 lg:col-span-2">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Responsável</span>
                <select value={meetingAssignedTo} onChange={(event) => setMeetingAssignedTo(event.target.value)} className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 text-sm font-black uppercase outline-none transition focus:border-blue-600">
                  {profiles.filter(profile => !selectedCalendar || (selectedCalendar.visibility === 'personal' ? profile.id === defaultAssignedTo : profile.sector === selectedCalendar.sector)).map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.full_name}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 sm:col-span-1 lg:col-span-2">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Local</span>
                <div className="relative">
                  <MapPin size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={meetingLocation} onChange={(event) => setMeetingLocation(event.target.value)} className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 pl-11 text-sm font-bold outline-none transition focus:border-blue-600" placeholder="Sala, link ou filial" />
                </div>
              </label>

              <label className="space-y-1 sm:col-span-2 lg:col-span-4">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Observações</span>
                <textarea value={meetingNotes} onChange={(event) => setMeetingNotes(event.target.value)} className="h-20 w-full resize-none rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-blue-600" placeholder="Pauta, participantes, materiais necessários..." />
              </label>

              {!editingMeeting && <label className={`flex h-11 items-center gap-3 rounded-2xl border-2 px-4 sm:col-span-2 lg:col-span-4 ${googleStatus.connected ? 'bg-green-50 border-green-100 text-green-800' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
                <input
                  type="checkbox"
                  checked={syncGoogleCalendar}
                  disabled={!googleStatus.connected || googleReconnectRequired || !writableGoogleCalendars.length}
                  onChange={(event) => setSyncGoogleCalendar(event.target.checked)}
                  className="h-5 w-5"
                />
                <span className="text-[10px] font-black uppercase tracking-widest">
                  Enviar também para o Google Calendar
                </span>
              </label>}
              {!editingMeeting && syncGoogleCalendar && <label className="space-y-1 sm:col-span-2 lg:col-span-4"><span className="text-xs font-semibold">Agenda de destino no Google</span><select aria-label="Agenda de destino no Google" value={googleCalendarId} onChange={event => setGoogleCalendarId(event.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm">{writableGoogleCalendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}</select></label>}
            </div>

            <div className="flex flex-col gap-3 border-t-2 border-slate-100 px-5 py-4 sm:flex-row">
              <button onClick={() => { setShowCreateModal(false); resetMeetingForm(); }} className="h-12 flex-1 rounded-2xl bg-slate-100 text-xs font-black uppercase text-slate-500 transition hover:bg-slate-200">
                Cancelar
              </button>
              <button onClick={submitMeeting} disabled={savingMeeting} className="h-12 flex-[2] rounded-2xl bg-blue-600 text-xs font-black uppercase tracking-widest text-white transition hover:bg-blue-700 disabled:opacity-50">
                {savingMeeting ? 'Salvando...' : editingMeeting ? 'Atualizar reunião' : 'Salvar reunião'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
