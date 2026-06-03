'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, Edit3, ExternalLink, MapPin, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { CreateMeetingInput } from '@/lib/api';
import { getAuthHeaders } from '@/lib/auth-headers';
import type { GoogleCalendarEvent } from '@/lib/google-calendar';
import type { ProcessedTask, Profile } from '@/lib/types';

interface MeetingCalendarViewProps {
  tasks: ProcessedTask[];
  profiles: Profile[];
  userSector: string;
  defaultAssignedTo: string;
  onDeleteTask: (taskId: string) => void;
  onToggleMeeting: (task: ProcessedTask) => void;
  onCreateMeeting: (meeting: CreateMeetingInput) => Promise<void>;
  onUpdateMeeting: (task: ProcessedTask, meeting: CreateMeetingInput) => Promise<void>;
}

const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function toISODate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthLabel(date: Date) {
  return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

export function MeetingCalendarView({
  tasks,
  profiles,
  userSector,
  defaultAssignedTo,
  onDeleteTask,
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
  const [meetingTime, setMeetingTime] = useState('09:00');
  const [meetingMotive, setMeetingMotive] = useState('');
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingNotes, setMeetingNotes] = useState('');
  const [meetingAssignedTo, setMeetingAssignedTo] = useState(defaultAssignedTo);
  const [savingMeeting, setSavingMeeting] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<ProcessedTask | null>(null);
  const [selectedMeeting, setSelectedMeeting] = useState<ProcessedTask | null>(null);

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
      .then((response) => response.ok ? response.json() : Promise.reject(response))
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
      const key = task.due_date || task.nextOcc;
      acc[key] = [...(acc[key] || []), task];
      return acc;
    }, {});
  }, [tasks]);

  const monthTasks = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();

    return tasks
      .filter((task) => {
        const date = new Date(`${task.due_date || task.nextOcc}T00:00:00`);
        return date.getFullYear() === year && date.getMonth() === month;
      })
      .sort((a, b) => (a.due_date || a.nextOcc).localeCompare(b.due_date || b.nextOcc));
  }, [tasks, visibleMonth]);
  const completedMonthTasks = useMemo(() => monthTasks.filter((task) => task.isDoneToday).length, [monthTasks]);
  const selectedMeetingDetails = useMemo(() => (
    selectedMeeting ? tasks.find((task) => task.id === selectedMeeting.id) || selectedMeeting : null
  ), [selectedMeeting, tasks]);

  const googleEventsByDay = useMemo(() => {
    const linkedEventIds = new Set(tasks.map((task) => task.google_event_id).filter(Boolean));

    return googleEvents.reduce<Record<string, GoogleCalendarEvent[]>>((acc, event) => {
      if (linkedEventIds.has(event.id)) return acc;
      const key = event.start?.date || event.start?.dateTime?.slice(0, 10);
      if (!key) return acc;

      acc[key] = [...(acc[key] || []), event];
      return acc;
    }, {});
  }, [googleEvents, tasks]);

  const getGoogleEventTime = (event: GoogleCalendarEvent) => {
    if (event.start?.date) return 'Dia todo';
    return event.start?.dateTime?.slice(11, 16) || '--:--';
  };

  const getAssigneeName = (task: ProcessedTask) =>
    profiles.find((profile) => profile.id === task.assigned_to)?.full_name || 'Sem responsável';

  const getMeetingTime = (task: ProcessedTask) => {
    const match = task.notes?.match(/Horário:\s*([0-9]{2}:[0-9]{2})/i);
    return match?.[1] || '--:--';
  };

  const isMeetingCompleted = (task: ProcessedTask) => task.isDoneToday;

  const getMeetingField = (task: ProcessedTask, label: string) => {
    const match = task.notes?.match(new RegExp(`${label}:\\s*([^\\n]+)`, 'i'));
    return match?.[1] || '';
  };

  const resetMeetingForm = useCallback(() => {
    setMeetingTitle('');
    setMeetingDate(toISODate(new Date()));
    setMeetingTime('09:00');
    setMeetingMotive('');
    setMeetingLocation('');
    setMeetingNotes('');
    setMeetingAssignedTo(defaultAssignedTo);
    setEditingMeeting(null);
  }, [defaultAssignedTo]);

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
    setMeetingDate(task.due_date || task.nextOcc || toISODate(new Date()));
    setMeetingTime(getMeetingTime(task) === '--:--' ? '09:00' : getMeetingTime(task));
    setMeetingMotive(getMeetingField(task, 'Motivo'));
    setMeetingLocation(getMeetingField(task, 'Local'));
    setMeetingNotes(getMeetingField(task, 'Observações'));
    setMeetingAssignedTo(task.assigned_to);
    setSyncGoogleCalendar(false);
    setShowCreateModal(true);
  };

  const submitMeeting = async () => {
    if (!meetingTitle || !meetingDate || !meetingTime || !meetingMotive || !meetingAssignedTo) {
      alert('Preencha título, data, hora, motivo e responsável.');
      return;
    }

    setSavingMeeting(true);
    try {
      const meeting = {
        title: meetingTitle,
        date: meetingDate,
        time: meetingTime,
        motive: meetingMotive,
        location: meetingLocation,
        notes: meetingNotes,
        assignedTo: meetingAssignedTo,
        sector: userSector,
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
    if (!confirm(`Excluir "${event.summary || 'Evento Google'}" do Google Calendar?`)) return;

    const response = await fetch(`/api/google-calendar/events?userId=${defaultAssignedTo}&eventId=${encodeURIComponent(event.id)}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      alert(data?.error || 'Não foi possível excluir o evento do Google Calendar.');
      return;
    }

    setGoogleEvents((current) => current.filter((item) => item.id !== event.id));
  };

  return (
    <main className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-7xl flex-col px-4 py-4 pb-24 sm:px-6 md:h-screen md:pb-4">
      <div className="mb-3 flex shrink-0 flex-col justify-between gap-3 rounded-3xl border border-slate-200 bg-white/70 px-3 py-3 shadow-sm backdrop-blur lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm">
            <CalendarDays size={22} strokeWidth={3} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-2xl font-black uppercase italic tracking-tight text-slate-900 sm:text-3xl">
                Reunião
              </h1>
              <span className="text-lg font-black uppercase tracking-tight text-slate-500 sm:text-xl">
                {monthLabel(visibleMonth)}
              </span>
            </div>
            <p className="truncate text-[10px] font-black uppercase tracking-widest text-blue-600">
              Agenda operacional • {monthTasks.length} {monthTasks.length === 1 ? 'reuniao' : 'reunioes'}
              {monthTasks.length > 0 ? ` • ${completedMonthTasks} concluida${completedMonthTasks === 1 ? '' : 's'}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setShowCreateModal(true)} className="flex h-10 items-center gap-2 rounded-2xl bg-blue-600 px-4 text-[10px] font-black uppercase tracking-widest text-white shadow-sm">
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
                    .catch(() => alert('Nao foi possivel iniciar a conexao com o Google Calendar.'));
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

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[32px] border-4 border-slate-900 bg-white shadow-[12px_12px_0px_0px_rgba(15,23,42,1)] sm:rounded-[40px]">
        <div className="shrink-0 border-b-4 border-slate-900 bg-slate-50 px-4 py-3 flex flex-col sm:flex-row justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-black uppercase italic tracking-tighter text-slate-900">
              {monthLabel(visibleMonth)}
            </h2>
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 mt-1">
              {monthTasks.length} {monthTasks.length === 1 ? 'reunião' : 'reuniões'} WALLY
              {monthTasks.length > 0 ? ` • ${completedMonthTasks} concluida${completedMonthTasks === 1 ? '' : 's'}` : ''}
              {googleStatus.connected ? ` • ${googleEvents.length} evento${googleEvents.length === 1 ? '' : 's'} Google` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400">
            <Clock size={16} /> Próximas ocorrências
          </div>
        </div>

        <div className="hidden shrink-0 md:grid grid-cols-7 bg-slate-900 text-white">
          {weekDays.map((day) => (
            <div key={day} className="px-4 py-2.5 text-center text-[10px] font-black uppercase tracking-widest">
              {day}
            </div>
          ))}
        </div>

        <div
          className="hidden min-h-0 flex-1 grid-cols-7 gap-[2px] bg-slate-200 md:grid"
          style={{ gridTemplateRows: `repeat(${calendarWeekCount}, minmax(0, 1fr))` }}
        >
          {days.map((day, index) => {
            const key = day ? toISODate(day) : `empty-${index}`;
            const dayKey = day ? toISODate(day) : '';
            const dayTasks = day ? tasksByDay[dayKey] || [] : [];
            const dayGoogleEvents = day ? googleEventsByDay[dayKey] || [] : [];
            const isToday = day && toISODate(day) === toISODate(new Date());

            return (
              <div key={key} className={`min-h-0 overflow-hidden bg-white p-2 ${!day ? 'bg-slate-50' : ''}`}>
                {day && (
                  <>
                    <div className={`mb-1.5 flex h-6 w-6 items-center justify-center rounded-lg text-[11px] font-black ${isToday ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                      {day.getDate()}
                    </div>
                    <div className="space-y-1">
                      {dayTasks.slice(0, 4).map((task) => {
                        const completed = isMeetingCompleted(task);

                        return (
                          <button
                            key={task.id}
                            onClick={() => setSelectedMeeting(task)}
                            className={`group flex w-full min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-left transition-all ${
                              completed
                                ? 'border-emerald-100 bg-emerald-50/80 opacity-80 hover:border-emerald-300'
                                : 'border-blue-100 bg-blue-50 hover:border-blue-300'
                            }`}
                          >
                            <span className={`h-2 w-2 shrink-0 rounded-full ${completed ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                            <span className={`shrink-0 text-[9px] font-black tabular-nums ${completed ? 'text-emerald-700/80' : 'text-slate-500'}`}>
                              {getMeetingTime(task)}
                            </span>
                            <span className={`min-w-0 flex-1 truncate text-[9px] font-black uppercase ${completed ? 'text-emerald-700 line-through decoration-2' : 'text-blue-700 group-hover:text-blue-800'}`}>
                              {task.title}
                            </span>
                            {completed && <CheckCircle2 size={11} className="shrink-0 text-emerald-600" />}
                          </button>
                        );
                      })}
                      {dayGoogleEvents.slice(0, 4).map((event) => (
                        <div key={event.id} className="flex min-w-0 items-center gap-1.5 rounded-lg border border-green-100 bg-green-50 px-2 py-1">
                          <a href={event.htmlLink} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-1.5 hover:text-green-700 transition-all">
                            <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                            <span className="shrink-0 text-[9px] font-black tabular-nums text-slate-500">{getGoogleEventTime(event)}</span>
                            <span className="min-w-0 flex-1 truncate text-[9px] font-black uppercase text-green-700">{event.summary || 'Evento Google'}</span>
                          </a>
                          <button onClick={() => deleteGoogleEvent(event)} className="shrink-0 text-red-400 transition hover:text-red-600" aria-label="Excluir evento Google">
                            <Trash2 size={10} />
                          </button>
                        </div>
                      ))}
                      {dayTasks.length + dayGoogleEvents.length > 8 && (
                        <div className="text-[9px] font-black uppercase text-slate-400 px-2">
                          +{dayTasks.length + dayGoogleEvents.length - 8} itens
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="md:hidden divide-y-2 divide-slate-100">
          {monthTasks.length === 0 && googleEvents.length === 0 ? (
            <div className="p-8 text-center text-xs font-black uppercase tracking-widest text-slate-300">
              Nenhuma reunião neste mês
            </div>
          ) : (
            <>
            {monthTasks.map((task) => {
              const completed = isMeetingCompleted(task);

              return (
              <div key={task.id} className={`w-full p-5 flex gap-4 transition-all ${completed ? 'bg-emerald-50/70 hover:bg-emerald-50' : 'hover:bg-blue-50'}`}>
                <div className={`w-14 h-14 rounded-2xl text-white flex flex-col items-center justify-center shrink-0 ${completed ? 'bg-emerald-600' : 'bg-blue-600'}`}>
                  <span className="text-lg font-black">{new Date(`${task.due_date || task.nextOcc}T00:00:00`).getDate()}</span>
                  <span className="text-[8px] font-black uppercase">
                    {new Date(`${task.due_date || task.nextOcc}T00:00:00`).toLocaleDateString('pt-BR', { month: 'short' })}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <button onClick={() => setSelectedMeeting(task)} className="text-left">
                    <div className="flex items-start gap-2">
                      <h3 className={`font-black uppercase leading-tight ${completed ? 'text-emerald-800 line-through decoration-2' : 'text-slate-900'}`}>{task.title}</h3>
                      {completed && <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />}
                    </div>
                  </button>
                  <p className={`text-[10px] font-bold uppercase mt-1 ${completed ? 'text-emerald-600/70' : 'text-slate-400'}`}>
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
                <div key={event.id} className="w-full p-5 text-left flex gap-4 hover:bg-green-50 transition-all">
                  <div className="w-14 h-14 rounded-2xl bg-green-600 text-white flex flex-col items-center justify-center shrink-0">
                    <span className="text-lg font-black">{new Date(`${eventDate}T00:00:00`).getDate()}</span>
                    <span className="text-[8px] font-black uppercase">
                      {new Date(`${eventDate}T00:00:00`).toLocaleDateString('pt-BR', { month: 'short' })}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[8px] font-black uppercase text-green-600 mb-1">Google Calendar</div>
                    <a href={event.htmlLink} target="_blank" rel="noreferrer" className="inline-flex items-start gap-2">
                      <h3 className="font-black uppercase text-slate-900 leading-tight">{event.summary || 'Evento Google'}</h3>
                      <ExternalLink size={14} className="text-green-600 shrink-0 mt-0.5" />
                    </a>
                    <p className="text-[10px] font-bold uppercase text-slate-400 mt-1">
                      {getGoogleEventTime(event)} {event.location ? `• ${event.location}` : ''}
                    </p>
                    <button onClick={() => deleteGoogleEvent(event)} className="mt-3 text-[10px] font-black uppercase text-red-500 flex items-center gap-1">
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

      {selectedMeetingDetails && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm"
          onMouseDown={() => setSelectedMeeting(null)}
        >
          <div
            className="w-full max-w-[740px] overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
              <div className="min-w-0">
                <div className="mb-3 flex items-center gap-2">
                  <span className={`h-3 w-3 rounded-full ${isMeetingCompleted(selectedMeetingDetails) ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    {isMeetingCompleted(selectedMeetingDetails) ? 'Reuniao concluida' : 'Reuniao agendada'}
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
                aria-label="Fechar detalhes da reuniao"
              >
                <X size={21} />
              </button>
            </div>

            <div className="grid gap-5 px-6 py-5 md:grid-cols-[1fr_260px]">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-bold text-slate-600">
                  <span>{new Date(`${selectedMeetingDetails.due_date || selectedMeetingDetails.lastOcc}T00:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</span>
                  <span className="text-slate-300">-</span>
                  <span>{getMeetingTime(selectedMeetingDetails)}</span>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Responsavel</p>
                      <p className="mt-1 text-sm font-black uppercase text-slate-800">{getAssigneeName(selectedMeetingDetails)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Localizacao</p>
                      <p className="mt-1 text-sm font-black uppercase text-slate-800">{getMeetingField(selectedMeetingDetails, 'Local') || 'Nao informado'}</p>
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
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Observacoes</p>
                  <p className="mt-2 min-h-20 rounded-2xl border border-slate-200 bg-white p-4 text-sm font-bold leading-relaxed text-slate-700 whitespace-pre-wrap">
                    {getMeetingField(selectedMeetingDetails, 'Observacoes') || getMeetingField(selectedMeetingDetails, 'Observações') || 'Sem observacoes adicionais.'}
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
                    const id = selectedMeetingDetails.id;
                    setSelectedMeeting(null);
                    onDeleteTask(id);
                  }}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-red-100 bg-red-50 px-4 text-[11px] font-black uppercase tracking-widest text-red-600 hover:bg-red-100"
                >
                  <Trash2 size={16} /> Excluir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/90 z-[70] flex items-center justify-center p-4 backdrop-blur-md">
          <div className="bg-white w-full max-w-2xl rounded-[36px] border-4 border-slate-900 shadow-[16px_16px_0px_0px_rgba(37,99,235,1)] max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b-4 border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black uppercase italic tracking-tighter">{editingMeeting ? 'Editar reunião' : 'Agendar reunião'}</h2>
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">{editingMeeting ? 'Atualizar compromisso da agenda' : 'Novo compromisso da agenda'}</p>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center">
                <X size={22} />
              </button>
            </div>

            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="sm:col-span-2 space-y-1">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Título</span>
                <input value={meetingTitle} onChange={(event) => setMeetingTitle(event.target.value)} className="w-full p-4 rounded-2xl bg-slate-50 border-2 border-slate-100 font-black uppercase outline-none focus:border-blue-600" placeholder="Ex: Alinhamento comercial" />
              </label>

              <label className="space-y-1">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Data</span>
                <input type="date" value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)} className="w-full p-4 rounded-2xl bg-slate-50 border-2 border-slate-100 font-black outline-none focus:border-blue-600" />
              </label>

              <label className="space-y-1">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Hora</span>
                <input type="time" value={meetingTime} onChange={(event) => setMeetingTime(event.target.value)} className="w-full p-4 rounded-2xl bg-slate-50 border-2 border-slate-100 font-black outline-none focus:border-blue-600" />
              </label>

              <label className="sm:col-span-2 space-y-1">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Motivo</span>
                <input value={meetingMotive} onChange={(event) => setMeetingMotive(event.target.value)} className="w-full p-4 rounded-2xl bg-slate-50 border-2 border-slate-100 font-bold outline-none focus:border-blue-600" placeholder="Ex: Definir prioridades da semana" />
              </label>

              <label className="space-y-1">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Responsável</span>
                <select value={meetingAssignedTo} onChange={(event) => setMeetingAssignedTo(event.target.value)} className="w-full p-4 rounded-2xl bg-slate-50 border-2 border-slate-100 font-black uppercase outline-none focus:border-blue-600">
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.full_name}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Local</span>
                <div className="relative">
                  <MapPin size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={meetingLocation} onChange={(event) => setMeetingLocation(event.target.value)} className="w-full p-4 pl-11 rounded-2xl bg-slate-50 border-2 border-slate-100 font-bold outline-none focus:border-blue-600" placeholder="Sala, link ou filial" />
                </div>
              </label>

              <label className="sm:col-span-2 space-y-1">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Observações</span>
                <textarea value={meetingNotes} onChange={(event) => setMeetingNotes(event.target.value)} className="w-full min-h-28 p-4 rounded-2xl bg-slate-50 border-2 border-slate-100 font-bold outline-none focus:border-blue-600 resize-none" placeholder="Pauta, participantes, materiais necessários..." />
              </label>

              {!editingMeeting && <label className={`sm:col-span-2 p-4 rounded-2xl border-2 flex items-center gap-3 ${googleStatus.connected ? 'bg-green-50 border-green-100 text-green-800' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
                <input
                  type="checkbox"
                  checked={syncGoogleCalendar}
                  disabled={!googleStatus.connected}
                  onChange={(event) => setSyncGoogleCalendar(event.target.checked)}
                  className="w-5 h-5"
                />
                <span className="text-[10px] font-black uppercase tracking-widest">
                  Enviar também para o Google Calendar
                </span>
              </label>}
            </div>

            <div className="p-6 border-t-4 border-slate-100 flex flex-col sm:flex-row gap-3">
              <button onClick={() => { setShowCreateModal(false); resetMeetingForm(); }} className="flex-1 p-4 rounded-2xl bg-slate-100 text-slate-500 font-black uppercase text-xs">
                Cancelar
              </button>
              <button onClick={submitMeeting} disabled={savingMeeting} className="flex-[2] p-4 rounded-2xl bg-blue-600 text-white font-black uppercase text-xs tracking-widest disabled:opacity-50">
                {savingMeeting ? 'Salvando...' : editingMeeting ? 'Atualizar reunião' : 'Salvar reunião'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
