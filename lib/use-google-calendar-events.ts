'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { getAuthHeaders } from '@/lib/auth-headers';
import { CalendarMonthCache, calendarMonth } from '@/lib/calendar-month-cache';
import { googleCalendarRequestError, needsGoogleReconnect } from '@/lib/google-calendar-client';
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from '@/lib/google-calendar';

export function useGoogleCalendarEvents(userId: string, connected: boolean, calendars: GoogleCalendarListEntry[], hidden: string[], month: Date, refreshKey: number) {
  const [cache] = useState(() => new CalendarMonthCache<GoogleCalendarEvent>());
  const [, redraw] = useReducer(value => value + 1, 0);
  const [mutation, setMutation] = useState(0);
  const previousRefresh = useRef(refreshKey);
  const [health, setHealth] = useState({ key: '', error: '', reconnectRequired: false });
  const range = calendarMonth(month);
  const selected = calendars.filter(calendar => !hidden.includes(`google:${calendar.id}`));
  const selection = JSON.stringify(selected.map(calendar => [calendar.id, calendar.summary]));
  const healthKey = `${range.key}:${selection}`;

  useEffect(() => {
    if (!connected) { cache.clear(); return; }
    if (previousRefresh.current !== refreshKey) { cache.invalidate(); previousRefresh.current = refreshKey; }
    let cancelled = false;
    const visible = JSON.parse(selection) as [string, string][];
    const current = new Date(`${range.key}-01T12:00:00`);
    const key = (calendarId: string, monthKey: string) => JSON.stringify([userId, calendarId, monthKey]);
    const load = async () => {
      const headers = await getAuthHeaders();
      const read = async (calendarId: string, offset: number) => {
        const bounds = calendarMonth(current, offset);
        return cache.load(key(calendarId, bounds.key), async () => {
          const search = new URLSearchParams({ userId, calendarId, timeMin: bounds.start.toISOString(), timeMax: bounds.end.toISOString() });
          const response = await fetch(`/api/google-calendar/events?${search}`, { headers });
          const data = await response.json();
          if (!response.ok) throw googleCalendarRequestError(data, 'Falha ao carregar eventos');
          return data.events || [];
        });
      };
      const failures: string[] = [];
      let reconnectRequired = false;
      for (let index = 0; index < visible.length && !cancelled; index += 4) {
        await Promise.all(visible.slice(index, index + 4).map(async ([id, name]) => {
          try { await read(id, 0); }
          catch (error) { failures.push(name); reconnectRequired ||= needsGoogleReconnect(error); }
          if (!cancelled) redraw();
        }));
      }
      if (cancelled) return;
      setHealth({ key: healthKey, error: failures.length ? `Não foi possível carregar: ${failures.join(', ')}. ${reconnectRequired ? 'Autorize a conexão Google novamente.' : 'Tente atualizar.'}` : '', reconnectRequired });
      if (failures.length) return;
      // Warm adjacent months only after the visible month, with bounded concurrency.
      const neighbors = [-1, 1].flatMap(offset => visible.map(([id]) => ({ id, offset })));
      for (let index = 0; index < neighbors.length && !cancelled; index += 4) {
        await Promise.all(neighbors.slice(index, index + 4).map(async ({ id, offset }) => {
          try { await read(id, offset); } catch { /* Retry when this month is actually opened. */ }
        }));
        if (!cancelled) redraw();
      }
    };
    void load().catch(error => { if (!cancelled) setHealth({ key: healthKey, error: 'Não foi possível carregar os eventos Google. Tente atualizar.', reconnectRequired: needsGoogleReconnect(error) }); });
    return () => { cancelled = true; };
  }, [cache, connected, userId, range.key, selection, healthKey, refreshKey, mutation]);

  const events = connected ? selected.flatMap(calendar => cache.peek(JSON.stringify([userId, calendar.id, range.key])) || []) : [];
  const loading = connected && selected.some(calendar => cache.peek(JSON.stringify([userId, calendar.id, range.key])) === undefined);
  const currentHealth = health.key === healthKey ? health : { error: '', reconnectRequired: false };
  return {
    events, loading, ...currentHealth,
    invalidate: () => { cache.invalidate(); setMutation(value => value + 1); },
    remove: (calendarId: string, eventId: string) => {
      cache.update(rows => rows.filter(event => event.calendarId !== calendarId || event.id !== eventId));
      redraw(); setMutation(value => value + 1);
    },
  };
}
