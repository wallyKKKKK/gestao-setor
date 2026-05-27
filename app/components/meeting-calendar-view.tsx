'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Edit3, ExternalLink, MapPin, Plus, Trash2, User, X } from 'lucide-react';
import type { CreateMeetingInput } from '@/lib/api';
import type { GoogleCalendarEvent } from '@/lib/google-calendar';
import type { ProcessedTask, Profile } from '@/lib/types';

interface MeetingCalendarViewProps {
  tasks: ProcessedTask[];
  profiles: Profile[];
  userSector: string;
  defaultAssignedTo: string;
  onViewTask: (task: ProcessedTask) => void;
  onDeleteTask: (taskId: string) => void;
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
  onViewTask,
  onDeleteTask,
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

  useEffect(() => {
    fetch(`/api/google-calendar/status?userId=${defaultAssignedTo}`)
      .then((response) => response.json())
      .then((data) => {
        setGoogleStatus({ configured: Boolean(data.configured), connected: Boolean(data.connected) });
        setSyncGoogleCalendar(Boolean(data.configured && data.connected));
      })
      .catch(() => {
        setGoogleStatus({ configured: false, connected: false });
      });
  }, [defaultAssignedTo]);

  useEffect(() => {
    if (!googleStatus.connected) return;

    const start = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
    const end = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);

    fetch(`/api/google-calendar/events?userId=${defaultAssignedTo}&timeMin=${encodeURIComponent(start.toISOString())}&timeMax=${encodeURIComponent(end.toISOString())}`)
      .then((response) => response.ok ? response.json() : Promise.reject(response))
      .then((data) => setGoogleEvents(data.events || []))
      .catch(() => setGoogleEvents([]));
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

  const getMeetingField = (task: ProcessedTask, label: string) => {
    const match = task.notes?.match(new RegExp(`${label}:\\s*([^\\n]+)`, 'i'));
    return match?.[1] || '';
  };

  const resetMeetingForm = () => {
    setMeetingTitle('');
    setMeetingDate(toISODate(new Date()));
    setMeetingTime('09:00');
    setMeetingMotive('');
    setMeetingLocation('');
    setMeetingNotes('');
    setMeetingAssignedTo(defaultAssignedTo);
    setEditingMeeting(null);
  };

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
          headers: { 'Content-Type': 'application/json' },
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
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      alert(data?.error || 'Não foi possível excluir o evento do Google Calendar.');
      return;
    }

    setGoogleEvents((current) => current.filter((item) => item.id !== event.id));
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 md:pb-8">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 mb-6">
        <div>
          <div className="flex items-center gap-3 text-blue-600 mb-2">
            <CalendarDays size={30} strokeWidth={3} />
            <span className="text-[10px] font-black uppercase tracking-[0.35em]">Agenda operacional</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-black uppercase italic tracking-tighter text-slate-900">
            Reunião
          </h1>
          <p className="text-xs sm:text-sm font-bold text-slate-500 mt-2">
            Calendário mensal das tarefas classificadas como reunião.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setShowCreateModal(true)} className="h-11 px-5 rounded-2xl bg-blue-600 text-white font-black uppercase text-[10px] tracking-widest shadow-sm flex items-center gap-2">
            <Plus size={18} /> Agendar reunião
          </button>
          {googleStatus.configured ? (
            <button
              onClick={() => {
                if (!googleStatus.connected) {
                  window.location.href = `/api/google-calendar/connect?userId=${defaultAssignedTo}`;
                }
              }}
              className={`h-11 px-5 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-sm ${
                googleStatus.connected ? 'bg-green-100 text-green-700 border-2 border-green-200' : 'bg-white text-slate-700 border-2 border-slate-100'
              }`}
            >
              {googleStatus.connected ? 'Google conectado' : 'Conectar Google'}
            </button>
          ) : (
            <span className="h-11 px-4 rounded-2xl bg-slate-100 text-slate-400 font-black uppercase text-[9px] tracking-widest flex items-center">
              Google não configurado
            </span>
          )}
          <button onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} className="w-11 h-11 rounded-2xl bg-white border-2 border-slate-100 flex items-center justify-center shadow-sm">
            <ChevronLeft size={20} />
          </button>
          <button onClick={() => {
            const now = new Date();
            setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1));
          }} className="h-11 px-5 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest shadow-sm">
            Hoje
          </button>
          <button onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} className="w-11 h-11 rounded-2xl bg-white border-2 border-slate-100 flex items-center justify-center shadow-sm">
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      <div className="bg-white border-4 border-slate-900 rounded-[32px] sm:rounded-[40px] shadow-[12px_12px_0px_0px_rgba(15,23,42,1)] overflow-hidden">
        <div className="p-5 sm:p-7 bg-slate-50 border-b-4 border-slate-900 flex flex-col sm:flex-row justify-between gap-3">
          <div>
            <h2 className="text-2xl sm:text-3xl font-black uppercase italic tracking-tighter text-slate-900">
              {monthLabel(visibleMonth)}
            </h2>
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 mt-1">
              {monthTasks.length} {monthTasks.length === 1 ? 'reunião' : 'reuniões'} WALLY
              {googleStatus.connected ? ` • ${googleEvents.length} evento${googleEvents.length === 1 ? '' : 's'} Google` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400">
            <Clock size={16} /> Próximas ocorrências
          </div>
        </div>

        <div className="hidden md:grid grid-cols-7 bg-slate-900 text-white">
          {weekDays.map((day) => (
            <div key={day} className="px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">
              {day}
            </div>
          ))}
        </div>

        <div className="hidden md:grid grid-cols-7 bg-slate-200 gap-[2px]">
          {days.map((day, index) => {
            const key = day ? toISODate(day) : `empty-${index}`;
            const dayKey = day ? toISODate(day) : '';
            const dayTasks = day ? tasksByDay[dayKey] || [] : [];
            const dayGoogleEvents = day ? googleEventsByDay[dayKey] || [] : [];
            const isToday = day && toISODate(day) === toISODate(new Date());

            return (
              <div key={key} className={`min-h-[150px] bg-white p-3 ${!day ? 'bg-slate-50' : ''}`}>
                {day && (
                  <>
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black mb-3 ${isToday ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                      {day.getDate()}
                    </div>
                    <div className="space-y-2">
                      {dayTasks.slice(0, 2).map((task) => (
                        <div key={task.id} className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2">
                          <button onClick={() => onViewTask(task)} className="w-full text-left hover:text-blue-700 transition-all">
                            <p className="text-[9px] font-black uppercase text-blue-700 line-clamp-2">{task.title}</p>
                            <p className="text-[8px] font-bold uppercase text-slate-400 mt-1 flex items-center gap-1">
                              <Clock size={10} /> {getMeetingTime(task)}
                              <User size={10} /> {getAssigneeName(task).split(' ')[0]}
                            </p>
                          </button>
                          <div className="mt-2 flex items-center gap-3">
                            <button onClick={() => openEditMeeting(task)} className="text-[8px] font-black uppercase text-blue-600 flex items-center gap-1">
                              <Edit3 size={10} /> Editar
                            </button>
                            <button onClick={() => onDeleteTask(task.id)} className="text-[8px] font-black uppercase text-red-500 flex items-center gap-1">
                              <Trash2 size={10} /> Excluir
                            </button>
                          </div>
                        </div>
                      ))}
                      {dayGoogleEvents.slice(0, 2).map((event) => (
                        <div key={event.id} className="rounded-xl border border-green-100 bg-green-50 px-3 py-2">
                          <a href={event.htmlLink} target="_blank" rel="noreferrer" className="block hover:text-green-700 transition-all">
                            <p className="text-[9px] font-black uppercase text-green-700 line-clamp-2">{event.summary || 'Evento Google'}</p>
                            <p className="text-[8px] font-bold uppercase text-slate-400 mt-1 flex items-center gap-1">
                              <Clock size={10} /> {getGoogleEventTime(event)}
                            </p>
                          </a>
                          <button onClick={() => deleteGoogleEvent(event)} className="mt-2 text-[8px] font-black uppercase text-red-500 flex items-center gap-1">
                            <Trash2 size={10} /> Excluir Google
                          </button>
                        </div>
                      ))}
                      {dayTasks.length + dayGoogleEvents.length > 4 && (
                        <div className="text-[9px] font-black uppercase text-slate-400 px-2">
                          +{dayTasks.length + dayGoogleEvents.length - 4} itens
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
            {monthTasks.map((task) => (
              <div key={task.id} className="w-full p-5 flex gap-4 hover:bg-blue-50 transition-all">
                <div className="w-14 h-14 rounded-2xl bg-blue-600 text-white flex flex-col items-center justify-center shrink-0">
                  <span className="text-lg font-black">{new Date(`${task.due_date || task.nextOcc}T00:00:00`).getDate()}</span>
                  <span className="text-[8px] font-black uppercase">
                    {new Date(`${task.due_date || task.nextOcc}T00:00:00`).toLocaleDateString('pt-BR', { month: 'short' })}
                  </span>
                </div>
                <div className="min-w-0">
                  <button onClick={() => onViewTask(task)} className="text-left">
                    <h3 className="font-black uppercase text-slate-900 leading-tight">{task.title}</h3>
                  </button>
                  <p className="text-[10px] font-bold uppercase text-slate-400 mt-1">
                    {getMeetingTime(task)} • {getAssigneeName(task)} • {task.sector}
                  </p>
                  {task.notes && <p className="text-xs font-bold text-slate-500 mt-2 line-clamp-2">{task.notes}</p>}
                  <div className="mt-3 flex items-center gap-4">
                    <button onClick={() => openEditMeeting(task)} className="text-[10px] font-black uppercase text-blue-600 flex items-center gap-1">
                      <Edit3 size={12} /> Editar reunião
                    </button>
                    <button onClick={() => onDeleteTask(task.id)} className="text-[10px] font-black uppercase text-red-500 flex items-center gap-1">
                      <Trash2 size={12} /> Excluir reunião
                    </button>
                  </div>
                </div>
              </div>
            ))}
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
