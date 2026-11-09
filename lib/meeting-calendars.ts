import type { ProcessedTask } from '@/lib/types';

export interface MeetingCalendar {
  id: string;
  name: string;
  color: string;
  visibility: 'personal' | 'sector';
  sector: string;
  owner_id: string;
}

export interface MeetingCalendarEvent {
  id: string;
  calendar_id: string;
  title: string;
  start_date: string;
  end_date: string;
  time: string;
  location: string;
  notes: string;
  assigned_to: string;
  created_by: string;
  completed: boolean;
  google_event_id: string | null;
  google_calendar_id: string | null;
  google_event_link: string | null;
  created_at: string;
}

export const CALENDAR_COLORS = ['#0891b2', '#2563eb', '#059669', '#d97706', '#dc2626', '#db2777', '#7c3aed', '#475569'];
export const CALENDAR_EVENT_COLUMNS = 'id,calendar_id,title,start_date,end_date,time,location,notes,assigned_to,created_by,completed,google_event_id,google_calendar_id,google_event_link,created_at';

export function calendarEventTask(event: MeetingCalendarEvent, calendar: MeetingCalendar): ProcessedTask {
  return {
    id: `calendar:${event.id}`, title: event.title,
    notes: [`Horário: ${event.time}`, `Data final: ${event.end_date}`, event.location ? `Local: ${event.location}` : '', event.notes ? `Observações: ${event.notes}` : ''].filter(Boolean).join('\n'),
    assigned_to: event.assigned_to, category: 'Reunião', sector: calendar.sector,
    status: event.completed ? 'concluido' : 'pendente', last_done_date: event.completed ? event.start_date : null,
    repeat_days: '', repeat_interval: 1, subtasks: [], due_date: event.start_date, is_one_off: true, archived_at: null,
    created_at: event.created_at, google_event_id: event.google_event_id, google_event_link: event.google_event_link,
    schedule_override_date: null, schedule_override_type: null, priority: 'normal', workflow_status: event.completed ? 'concluida' : 'pendente',
    workflow_started_by: null, workflow_started_by_name: null, workflow_started_at: null, workflow_blocked_reason: null,
    lastOcc: event.start_date, nextOcc: event.start_date, isDoneToday: event.completed,
  };
}

export function calendarForeground(color: string) {
  const rgb = color.replace('#', '').match(/.{2}/g)?.map(value => Number.parseInt(value, 16)) || [0, 0, 0];
  return rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 155 ? '#111827' : '#ffffff';
}

export function googleEventKey(calendarId: string | null | undefined, eventId: string) {
  return JSON.stringify([calendarId || 'primary', eventId]);
}
