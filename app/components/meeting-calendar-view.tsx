'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, ChevronLeft, ChevronRight, Edit3, ExternalLink, MapPin, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { CreateMeetingInput } from '@/lib/api';
import { getAuthHeaders } from '@/lib/auth-headers';
import { getPermissionDeniedMessage } from '@/lib/permissions';
import type { GoogleCalendarEvent } from '@/lib/google-calendar';
import type { ProcessedTask, Profile } from '@/lib/types';

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
  yellow: 'bg-yellow-300 text-yellow-950 hover:bg-yellow-400',
  amber: 'bg-amber-300 text-amber-950 hover:bg-amber-400',
  orange: 'bg-orange-400 text-orange-950 hover:bg-orange-500',
  red: 'bg-red-500 text-white hover:bg-red-600',
  pink: 'bg-rose-500 text-white hover:bg-rose-600',
  fuchsia: 'bg-fuchsia-500 text-white hover:bg-fuchsia-600',
  purple: 'bg-purple-500 text-white hover:bg-purple-600',
  violet: 'bg-violet-500 text-white hover:bg-violet-600',
  indigo: 'bg-indigo-500 text-white hover:bg-indigo-600',
  blue: 'bg-blue-600 text-white hover:bg-blue-700',
  cyan: 'bg-cyan-500 text-white hover:bg-cyan-600',
  done: 'bg-emerald-400 text-emerald-950/80 hover:bg-emerald-500',
  google: 'bg-sky-200 text-sky-950 hover:bg-sky-300',
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
  tasks,
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
  const [googleEvents, setGoogleEvents] = useState<GoogleCalendarEvent[]>([]);
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
  const deleteMeetingDeniedMessage = getPermissionDeniedMessage('excluir reunioes', 'managerOrAdmin');

  useEffect(() => {
    let cancelled = false;

    getAuthHeaders()
      .then((headers) => fetch(`/api/google-calendar/status?userId=${defaultAssignedTo}`, { headers }))
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        setGoogleStatus({ configured: Boolean(data.configured), connected: Boolean(data.connected) });
        setSyncGoogleCalendar(Boolean(data.configured && data.connected));
      })
      .catch(() => {
        if (cancelled) return;
        setGoogleStatus({ configured: false, connected: false });
      });

    return () => {
      cancelled = true;
    };
  }, [defaultAssignedTo]);

  useEffect(() => {
    if (!googleStatus.connected) return;
    let cancelled = false;

    const start = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
    const end = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);

    getAuthHeaders()
      .then((headers) => fetch(`/api/google-calendar/events?userId=${defaultAssignedTo}&timeMin=${encodeURIComponent(start.toISOString())}&timeMax=${encodeURIComponent(end.toISOString())}`, { headers }))
      .then(async (response) => {
        if (response.ok) return response.json();
        const data = await response.json().catch(() => null);
        if (data?.reconnectRequired && !cancelled) {
          setGoogleStatus((current) => ({ ...current, connected: false }));
          setSyncGoogleCalendar(false);
        }
        throw new Error(data?.error || 'Não foi possível carregar eventos do Google Calendar.');
      })
      .then((data) => {
        if (!cancelled) setGoogleEvents(data.events || []);
      })
      .catch(() => {
        if (!cancelled) setGoogleEvents([]);
      });

    return () => {
      cancelled = true;
    };
  }, [defaultAssignedTo, googleStatus.connected, visibleMonth]);

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
    const linkedEventIds = new Set(tasks.map((task) => task.google_event_id).filter(Boolean));

    return googleEvents.reduce<Record<string, GoogleCalendarEvent[]>>((acc, event) => {
      if (linkedEventIds.has(event.id)) return acc;
      const startDate = getGoogleEventStartDate(event);
      const endDate = getGoogleEventEndDate(event);
      if (!startDate) return acc;

      getISODateRange(startDate, endDate).forEach((key) => {
        acc[key] = [...(acc[key] || []), event];
      });

      return acc;
    }, {});
  }, [googleEvents, tasks]);

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

  const monthGoogleEvents = useMemo(() => {
    const linkedEventIds = new Set(tasks.map((task) => task.google_event_id).filter(Boolean));
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const monthStart = toISODate(new Date(year, month, 1));
    const monthEnd = toISODate(new Date(year, month + 1, 0));

    return googleEvents
      .filter((event) => {
        if (linkedEventIds.has(event.id)) return false;
        const startDate = getGoogleEventStartDate(event);
        const endDate = getGoogleEventEndDate(event);
        return Boolean(startDate) && startDate <= monthEnd && endDate >= monthStart;
      })
      .map((event) => ({
        id: `google:${event.id}`,
        date: getGoogleEventStartDate(event),
        endDate: getGoogleEventEndDate(event),
        time: getGoogleEventTime(event),
        title: event.summary || 'Evento Google',
        source: 'Google',
        completed: false,
      }));
  }, [googleEvents, tasks, visibleMonth]);

  const monthSummaryItems = useMemo(() => (
    [
      ...monthTasks.map((task) => ({
        id: `task:${task.id}`,
        date: getMeetingStartDate(task),
        endDate: getMeetingEndDate(task),
        time: getMeetingTime(task),
        title: task.title,
        source: getAssigneeName(task),
        completed: isMeetingCompleted(task),
      })),
      ...monthGoogleEvents,
    ]
      .sort((left, right) => (
        left.date.localeCompare(right.date)
        || getTimeSortValue(left.time) - getTimeSortValue(right.time)
        || left.title.localeCompare(right.title)
      ))
      .slice(0, 5)
  ), [getAssigneeName, monthGoogleEvents, monthTasks]);

  const monthActiveDays = useMemo(() => {
    const dates = new Set<string>();
    monthTasks.forEach((task) => {
      getISODateRange(getMeetingStartDate(task), getMeetingEndDate(task)).forEach((date) => dates.add(date));
    });
    monthGoogleEvents.forEach((event) => {
      getISODateRange(event.date, event.endDate).forEach((date) => dates.add(date));
    });
    return dates.size;
  }, [monthGoogleEvents, monthTasks]);

  const resetMeetingForm = useCallback(() => {
    setMeetingTitle('');
    setMeetingDate(toISODate(new Date()));
    setMeetingEndDate(toISODate(new Date()));
    setMeetingTime('09:00');
    setMeetingMotive('');
    setMeetingLocation('');
    setMeetingNotes('');
    setMeetingAssignedTo(defaultAssignedTo);
    setEditingMeeting(null);
  }, [defaultAssignedTo]);

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
    setSyncGoogleCalendar(false);
    setShowCreateModal(true);
  };

  const submitMeeting = async () => {
    if (!meetingTitle || !meetingDate || !meetingEndDate || !meetingTime || !meetingMotive || !meetingAssignedTo) {
      alert('Preencha titulo, data inicial, data final, hora, motivo e responsavel.');
      return;
    }

    if (meetingEndDate < meetingDate) {
      alert('A data final nao pode ser anterior a data inicial.');
      return;
    }

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
        sector: userSector,
        tone: editingMeeting ? getStoredMeetingTone(editingMeeting) || randomMeetingEventTone() : randomMeetingEventTone(),
      };
      let googleEvent: { id?: string; htmlLink?: string } | null = null;

      if (!editingMeeting && syncGoogleCalendar && googleStatus.connected) {
        const response = await fetch('/api/google-calendar/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...await getAuthHeaders() },
          body: JSON.stringify({ userId: defaultAssignedTo, meeting }),
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
      }

      if (editingMeeting) {
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
    } finally {
      setSavingMeeting(false);
    }
  };

  const deleteGoogleEvent = async (event: GoogleCalendarEvent) => {
    if (!canDeleteMeetings) {
      alert(deleteMeetingDeniedMessage);
      return;
    }
    if (!confirm(`Excluir "${event.summary || 'Evento Google'}" do Google Calendar?`)) return;

    const response = await fetch(`/api/google-calendar/events?userId=${defaultAssignedTo}&eventId=${encodeURIComponent(event.id)}`, {
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

    setGoogleEvents((current) => current.filter((item) => item.id !== event.id));
  };

  const connectGoogle = () => {
    if (googleStatus.connected) return;

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
      <div className="hidden">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black uppercase tracking-tight text-slate-900 sm:text-base">
            {monthLabel(visibleMonth)}
          </p>
          <p className="truncate text-[10px] font-black uppercase tracking-widest text-blue-600">
            {monthTasks.length} {monthTasks.length === 1 ? 'reunião' : 'reuniões'}
            {monthTasks.length > 0 ? ` • ${completedMonthTasks} concluída${completedMonthTasks === 1 ? '' : 's'}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => openCreateMeeting()} className="flex h-10 items-center gap-2 rounded-2xl bg-blue-600 px-4 text-[10px] font-black uppercase tracking-widest text-white shadow-sm">
            <Plus size={18} /> Agendar reunião
          </button>
          {googleStatus.configured ? (
            <button
              onClick={() => {
                if (!googleStatus.connected) {
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
                }
              }}
              className={`h-10 rounded-2xl px-4 text-[10px] font-black uppercase tracking-widest shadow-sm ${
                googleStatus.connected ? 'bg-green-100 text-green-700 border-2 border-green-200' : 'bg-white text-slate-700 border-2 border-slate-100'
              }`}
            >
              {googleStatus.connected ? 'Google conectado' : 'Conectar Google'}
            </button>
          ) : (
            <span className="flex h-10 items-center rounded-2xl bg-slate-100 px-3 text-[9px] font-black uppercase tracking-widest text-slate-400">
              Google não configurado
            </span>
          )}
          <button onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} className="flex h-10 w-10 items-center justify-center rounded-2xl border-2 border-slate-100 bg-white shadow-sm">
            <ChevronLeft size={20} />
          </button>
          <button onClick={() => {
            const now = new Date();
            setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1));
          }} className="h-10 rounded-2xl bg-slate-900 px-4 text-[10px] font-black uppercase tracking-widest text-white shadow-sm">
            Hoje
          </button>
          <button onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} className="flex h-10 w-10 items-center justify-center rounded-2xl border-2 border-slate-100 bg-white shadow-sm">
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
        <aside className="hidden w-[270px] shrink-0 flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.10)] xl:flex">
          <div className="shrink-0">
            <div className="border-b border-slate-100 bg-slate-950 px-4 py-3 text-white">
              <p className="text-[9px] font-black uppercase tracking-[0.22em] text-blue-200">Resumo do mês</p>
              <div className="mt-1 flex items-end justify-between gap-3">
                <h3 className="text-xl font-black uppercase italic tracking-tighter">
                  {visibleMonth.toLocaleDateString('pt-BR', { month: 'short' })}
                </h3>
                <span className="pb-0.5 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {visibleMonth.getFullYear()}
                </span>
              </div>
            </div>

            <div className="space-y-2 p-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2">
                  <p className="text-[8px] font-black uppercase tracking-widest text-blue-500">Reuniões</p>
                  <p className="text-xl font-black text-slate-950">{monthTasks.length}</p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                  <p className="text-[8px] font-black uppercase tracking-widest text-emerald-600">Concluídas</p>
                  <p className="text-xl font-black text-slate-950">{completedMonthTasks}</p>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
                  <p className="text-[8px] font-black uppercase tracking-widest text-amber-600">Pendentes</p>
                  <p className="text-xl font-black text-slate-950">{Math.max(monthTasks.length - completedMonthTasks, 0)}</p>
                </div>
                <div className="rounded-xl border border-violet-100 bg-violet-50 px-3 py-2">
                  <p className="text-[8px] font-black uppercase tracking-widest text-violet-600">Dias ativos</p>
                  <p className="text-xl font-black text-slate-950">{monthActiveDays}</p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                <div>
                  <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Google</p>
                  <p className="text-xs font-black uppercase text-slate-800">
                    {monthGoogleEvents.length} externo{monthGoogleEvents.length === 1 ? '' : 's'}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-widest ${
                  googleStatus.connected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
                }`}>
                  {googleStatus.connected ? 'On' : 'Off'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col border-t border-slate-100">
            <p className="shrink-0 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Próximas do mês</p>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {monthSummaryItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-300">
                  Sem compromissos
                </div>
              ) : (
                <div className="space-y-2">
                  {monthSummaryItems.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-black uppercase text-blue-600">
                          {new Date(`${item.date}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase ${
                          item.completed ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {item.completed ? 'Ok' : item.time}
                        </span>
                      </div>
                      <p className={`mt-2 line-clamp-2 text-xs font-black uppercase leading-snug ${
                        item.completed ? 'text-slate-500' : 'text-slate-950'
                      }`}>
                        {item.title}
                      </p>
                      <p className="mt-1 truncate text-[9px] font-black uppercase tracking-widest text-slate-400">
                        {item.source}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.10)] sm:rounded-[28px]">
        <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-black uppercase italic tracking-tighter text-slate-900 sm:text-xl">
                {monthLabel(visibleMonth)}
              </h2>
              <p className="mt-0.5 truncate text-[9px] font-black uppercase tracking-widest text-blue-600">
                {monthTasks.length} {monthTasks.length === 1 ? 'reunião' : 'reuniões'} WALLY
                {monthTasks.length > 0 ? ` - ${completedMonthTasks} concluída${completedMonthTasks === 1 ? '' : 's'}` : ''}
                {googleStatus.connected ? ` - ${googleEvents.length} evento${googleEvents.length === 1 ? '' : 's'} Google` : ''}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <button onClick={() => openCreateMeeting()} className="flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-[9px] font-black uppercase tracking-widest text-white shadow-sm transition hover:bg-blue-700">
                <Plus size={14} /> Agendar reunião
              </button>
              {googleStatus.configured ? (
                <button
                  onClick={connectGoogle}
                  className={`h-8 rounded-lg border px-3 text-[9px] font-black uppercase tracking-widest shadow-sm transition ${
                    googleStatus.connected ? 'border-green-200 bg-green-100 text-green-700' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'
                  }`}
                >
                  {googleStatus.connected ? 'Google conectado' : 'Conectar Google'}
                </button>
              ) : (
                <span className="flex h-8 items-center rounded-lg bg-slate-100 px-2 text-[8px] font-black uppercase tracking-widest text-slate-400">
                  Google não configurado
                </span>
              )}
              <button onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm transition hover:border-blue-300">
                <ChevronLeft size={17} />
              </button>
              <button onClick={() => {
                const now = new Date();
                setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1));
              }} className="h-8 rounded-lg bg-slate-900 px-3 text-[9px] font-black uppercase tracking-widest text-white shadow-sm transition hover:bg-slate-700">
                Hoje
              </button>
              <button onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm transition hover:border-blue-300">
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        </div>

        <div className="hidden shrink-0 grid-cols-7 bg-slate-950 text-white md:grid">
          {weekDays.map((day) => (
            <div key={day} className="px-4 py-2.5 text-center text-[10px] font-black uppercase tracking-widest">
              {day}
            </div>
          ))}
        </div>

        <div
          className="hidden min-h-0 flex-1 grid-cols-7 gap-2 bg-slate-950 p-2 md:grid"
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
                  id: `google:${event.id}`,
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
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openCreateMeeting(day);
                  }
                } : undefined}
                role={day ? 'button' : undefined}
                tabIndex={day ? 0 : undefined}
                title={day ? 'Clique para agendar uma reuniao neste dia' : undefined}
                className={`relative flex min-h-0 flex-col overflow-hidden rounded-2xl border p-2 transition ${
                  day
                    ? 'cursor-pointer border-slate-200 bg-white hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-[0_14px_28px_rgba(15,23,42,0.16)] focus:outline-none focus:ring-2 focus:ring-blue-300'
                    : 'border-slate-200/40 bg-slate-100/80'
                }`}
              >
                {day && (
                  <>
                    {calendarItems.length > 0 && (
                      <div className="absolute inset-x-0 bottom-0 top-0 overflow-hidden rounded-2xl">
                        {calendarItems.map((item, itemIndex) => {
                          const itemCount = calendarItems.length;
                          const segmentHeight = itemCount === 1 ? 50 : 100 / itemCount;
                          const segmentTop = itemCount === 1 ? 50 : itemIndex * segmentHeight;
                          const tone = item.type === 'task'
                            ? getMeetingEventTone(item.task, itemIndex)
                            : getStableMeetingEventTone(item.event.id || item.event.summary || item.id, itemIndex);
                          const fillClassName = meetingEventFillClassNames[tone] || meetingEventFillClassNames.blue;
                          const isRangeEvent = item.rangeEnd > item.rangeStart;
                          const shouldShowRangeLabel = !isRangeEvent || dayKey === item.rangeStart || day?.getDay() === 0;

                          if (item.type === 'google') {
                            return (
                              <div
                                key={item.id}
                                onClick={(clickEvent) => clickEvent.stopPropagation()}
                                className={`absolute inset-x-0 flex min-w-0 items-center gap-1.5 px-2 text-left text-[10px] font-black uppercase transition ${fillClassName}`}
                                style={{ height: `${segmentHeight}%`, top: `${segmentTop}%` }}
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
                                  className={`shrink-0 transition ${canDeleteMeetings ? 'opacity-80 hover:opacity-100' : 'cursor-not-allowed opacity-40'}`}
                                  title={canDeleteMeetings ? 'Excluir evento Google' : deleteMeetingDeniedMessage}
                                  aria-label="Excluir evento Google"
                                  aria-disabled={!canDeleteMeetings}
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
                              className={`absolute inset-x-0 flex min-w-0 items-center gap-1.5 px-2 text-left text-[10px] font-black uppercase transition ${fillClassName}`}
                              style={{ height: `${segmentHeight}%`, top: `${segmentTop}%` }}
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

                    <div className={`absolute left-1 top-1 z-20 flex h-5 w-5 items-center justify-center rounded-lg text-[10px] font-black shadow-sm ring-1 ring-white/70 ${
                      isToday ? 'bg-blue-600 text-white' : 'bg-white/90 text-slate-600'
                    }`}>
                      {day.getDate()}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 divide-y-2 divide-slate-100 overflow-y-auto md:hidden">
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
                <div className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl text-white ${completed ? 'bg-emerald-600' : 'bg-blue-600'}`}>
                  <span className="text-lg font-black">{new Date(`${task.due_date || task.nextOcc}T00:00:00`).getDate()}</span>
                  <span className="text-[8px] font-black uppercase">
                    {new Date(`${task.due_date || task.nextOcc}T00:00:00`).toLocaleDateString('pt-BR', { month: 'short' })}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <button onClick={() => setSelectedMeeting(task)} className="block w-full text-left">
                    <div className="flex items-start gap-2">
                      <h3 className={`line-clamp-2 text-sm font-black uppercase leading-tight ${completed ? 'text-emerald-800/65' : 'text-slate-900'}`}>{task.title}</h3>
                      {completed && <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />}
                    </div>
                  </button>
                  <p className={`mt-1 truncate text-[10px] font-bold uppercase ${completed ? 'text-emerald-600/70' : 'text-slate-400'}`}>
                    {getMeetingTime(task)} • {getAssigneeName(task)} • {task.sector}
                  </p>
                  {task.notes && <p className={`text-xs font-bold mt-2 line-clamp-2 ${completed ? 'text-emerald-700/70' : 'text-slate-500'}`}>{task.notes}</p>}
                </div>
              </div>
              );
            })}
            {googleEvents.map((event) => {
              const eventDate = event.start?.date || event.start?.dateTime?.slice(0, 10) || toISODate(new Date());

              return (
                <div key={event.id} className="flex w-full gap-3 p-4 text-left transition-all hover:bg-green-50">
                  <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-green-600 text-white">
                    <span className="text-lg font-black">{new Date(`${eventDate}T00:00:00`).getDate()}</span>
                    <span className="text-[8px] font-black uppercase">
                      {new Date(`${eventDate}T00:00:00`).toLocaleDateString('pt-BR', { month: 'short' })}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[8px] font-black uppercase text-green-600 mb-1">Google Calendar</div>
                    <a href={event.htmlLink} target="_blank" rel="noreferrer" className="inline-flex items-start gap-2">
                      <h3 className="line-clamp-2 text-sm font-black uppercase leading-tight text-slate-900">{event.summary || 'Evento Google'}</h3>
                      <ExternalLink size={14} className="text-green-600 shrink-0 mt-0.5" />
                    </a>
                    <p className="text-[10px] font-bold uppercase text-slate-400 mt-1">
                      {getGoogleEventTime(event)} {event.location ? `• ${event.location}` : ''}
                    </p>
                    <button
                      onClick={() => deleteGoogleEvent(event)}
                      className={`mt-3 flex items-center gap-1 text-[10px] font-black uppercase ${canDeleteMeetings ? 'text-red-500' : 'cursor-not-allowed text-slate-300 opacity-60'}`}
                      title={canDeleteMeetings ? 'Excluir evento Google' : deleteMeetingDeniedMessage}
                      aria-disabled={!canDeleteMeetings}
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
            className="w-full max-w-[740px] overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]"
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
                  onClick={() => onToggleMeeting(selectedMeetingDetails)}
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
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-[11px] font-black uppercase tracking-widest text-slate-700 hover:border-blue-300 hover:text-blue-600"
                >
                  <Edit3 size={16} /> Editar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!canDeleteMeetings) {
                      alert(deleteMeetingDeniedMessage);
                      return;
                    }
                    const id = selectedMeetingDetails.id;
                    setSelectedMeeting(null);
                    onDeleteTask(id);
                  }}
                  title={canDeleteMeetings ? 'Excluir reuniao' : deleteMeetingDeniedMessage}
                  aria-disabled={!canDeleteMeetings}
                  className={`inline-flex h-12 items-center justify-center gap-2 rounded-2xl border px-4 text-[11px] font-black uppercase tracking-widest ${
                    canDeleteMeetings
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
          <div className="w-full max-w-4xl overflow-visible rounded-[30px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
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
              <label className="sm:col-span-2 space-y-1">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Título</span>
                <input value={meetingTitle} onChange={(event) => setMeetingTitle(event.target.value)} className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 text-sm font-black uppercase outline-none transition focus:border-blue-600" placeholder="Ex: Alinhamento comercial" />
              </label>

              <label className="space-y-1">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Data inicial</span>
                <input type="date" value={meetingDate} onChange={(event) => {
                  const nextDate = event.target.value;
                  setMeetingDate(nextDate);
                  if (meetingEndDate < nextDate) setMeetingEndDate(nextDate);
                }} className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 text-sm font-black outline-none transition focus:border-blue-600" />
              </label>

              <label className="space-y-1">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Data final</span>
                <input type="date" value={meetingEndDate} min={meetingDate} onChange={(event) => setMeetingEndDate(event.target.value)} className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 text-sm font-black outline-none transition focus:border-blue-600" />
              </label>

              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Hora</span>
                <TimePickerField value={meetingTime} onChange={setMeetingTime} />
              </div>

              <label className="space-y-1 sm:col-span-2 lg:col-span-4">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Motivo</span>
                <input value={meetingMotive} onChange={(event) => setMeetingMotive(event.target.value)} className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 text-sm font-bold outline-none transition focus:border-blue-600" placeholder="Ex: Definir prioridades da semana" />
              </label>

              <label className="space-y-1 sm:col-span-1 lg:col-span-2">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Responsável</span>
                <select value={meetingAssignedTo} onChange={(event) => setMeetingAssignedTo(event.target.value)} className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 text-sm font-black uppercase outline-none transition focus:border-blue-600">
                  {profiles.map((profile) => (
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
                  disabled={!googleStatus.connected}
                  onChange={(event) => setSyncGoogleCalendar(event.target.checked)}
                  className="h-5 w-5"
                />
                <span className="text-[10px] font-black uppercase tracking-widest">
                  Enviar também para o Google Calendar
                </span>
              </label>}
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
