'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { CALENDAR_EVENT_COLUMNS, type MeetingCalendar, type MeetingCalendarEvent } from '@/lib/meeting-calendars';

export function useMeetingCalendars(userId: string, month: Date, refreshKey: number) {
  const [calendars, setCalendars] = useState<MeetingCalendar[]>([]);
  const [events, setEvents] = useState<MeetingCalendarEvent[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const monthStart = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-01`;
  const monthEnd = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()}`;

  useEffect(() => {
    const version = ++request.current;
    const load = async () => {
      setLoading(true);
      try {
        const result = await supabase.from('meeting_calendars').select('id,name,color,visibility,sector,owner_id').order('name');
        if (result.error) throw result.error;
        const rows: MeetingCalendarEvent[] = [];
        for (let offset = 0; ; offset += 1000) {
          const page = await supabase.from('meeting_calendar_events').select(CALENDAR_EVENT_COLUMNS).lte('start_date', monthEnd).gte('end_date', monthStart).order('id').range(offset, offset + 999);
          if (page.error) throw page.error;
          rows.push(...(page.data || []) as MeetingCalendarEvent[]);
          if (version !== request.current) return;
          if ((page.data || []).length < 1000) break;
        }
        if (version !== request.current) return;
        setCalendars((result.data || []) as MeetingCalendar[]);
        setEvents(rows);
        setError('');
      } catch {
        if (version === request.current) setError('Não foi possível carregar suas agendas do app. Tente atualizar.');
      } finally { if (version === request.current) setLoading(false); }
    };
    queueMicrotask(() => { if (version === request.current) void load(); });
    return () => { request.current += 1; };
  }, [userId, monthStart, monthEnd, refreshKey]);

  const createCalendar = useCallback(async (name: string, color: string, visibility: 'personal' | 'sector', sector: string) => {
    const { data, error } = await supabase.from('meeting_calendars').insert({ name: name.trim().replace(/\s+/g, ' '), color, visibility, sector, owner_id: userId }).select('id,name,color,visibility,sector,owner_id').single();
    if (error) throw new Error(error.code === '23505' ? 'Já existe uma agenda com este nome.' : 'Não foi possível criar a agenda. Tente novamente.');
    request.current += 1; setLoading(false);
    setCalendars(current => [...current, data as MeetingCalendar].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
    return data as MeetingCalendar;
  }, [userId]);

  const saveEvent = async (id: string | null, values: {
    calendar_id: string; title: string; start_date: string; end_date: string; time: string;
    location: string; notes: string; assigned_to: string; google_event_id?: string | null; google_calendar_id?: string | null; google_event_link?: string | null;
  }) => {
    const { calendar_id, google_event_id, google_calendar_id, google_event_link, ...editable } = values;
    const operation = id ? supabase.from('meeting_calendar_events').update(editable).eq('id', id)
      : supabase.from('meeting_calendar_events').insert({ ...editable, calendar_id, google_event_id, google_calendar_id, google_event_link, created_by: userId });
    const { data, error } = await operation.select(CALENDAR_EVENT_COLUMNS).single();
    if (error) throw new Error('Não foi possível salvar o evento nesta agenda. Confira suas permissões e tente novamente.');
    request.current += 1; setLoading(false);
    setEvents(current => [data as MeetingCalendarEvent, ...current.filter(event => event.id !== data.id)]);
    return data as MeetingCalendarEvent;
  };

  const toggleEvent = async (event: MeetingCalendarEvent) => {
    const { data, error } = await supabase.from('meeting_calendar_events').update({ completed: !event.completed }).eq('id', event.id).select(CALENDAR_EVENT_COLUMNS).single();
    if (error) throw new Error('Não foi possível atualizar o evento.');
    request.current += 1; setLoading(false);
    setEvents(current => current.map(row => row.id === event.id ? data as MeetingCalendarEvent : row));
  };

  const deleteEvent = async (id: string) => {
    const { data, error } = await supabase.from('meeting_calendar_events').delete().eq('id', id).select('id');
    if (error || !data?.length) throw new Error('Não foi possível excluir o evento.');
    request.current += 1; setLoading(false);
    setEvents(current => current.filter(event => event.id !== id));
  };
  return { calendars, events, error, loading, createCalendar, saveEvent, toggleEvent, deleteEvent };
}
