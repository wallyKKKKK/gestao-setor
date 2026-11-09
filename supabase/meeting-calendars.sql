create table public.meeting_calendars (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  color text not null default '#0891b2' check (color ~ '^#[0-9a-fA-F]{6}$'),
  visibility text not null check (visibility in ('personal', 'sector')),
  sector text not null,
  owner_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index meeting_calendars_personal_name_idx on public.meeting_calendars(owner_id, lower(btrim(name))) where visibility='personal';
create unique index meeting_calendars_sector_name_idx on public.meeting_calendars(sector, lower(btrim(name))) where visibility='sector';
create index meeting_calendars_owner_idx on public.meeting_calendars(owner_id);
alter table public.meeting_calendars enable row level security;
revoke all on public.meeting_calendars from anon, authenticated;
grant select, insert on public.meeting_calendars to authenticated;
create policy meeting_calendars_read on public.meeting_calendars for select to authenticated using (
  exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_active and p.account_status='approved'
    and ((meeting_calendars.visibility='personal' and meeting_calendars.owner_id=p.id) or (meeting_calendars.visibility='sector' and (meeting_calendars.sector=p.sector or p.role='admin'))))
);
create policy meeting_calendars_create on public.meeting_calendars for insert to authenticated with check (
  owner_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_active and p.account_status='approved' and meeting_calendars.sector=p.sector)
);

create table public.meeting_calendar_events (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.meeting_calendars(id),
  title text not null check(length(btrim(title)) between 1 and 200),
  start_date date not null,
  end_date date not null check(end_date>=start_date),
  time text not null default '09:00' check(time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  location text not null default '' check(length(location)<=1000),
  notes text not null default '' check(length(notes)<=20000),
  assigned_to uuid not null references auth.users(id),
  created_by uuid not null default auth.uid() references auth.users(id),
  completed boolean not null default false,
  google_event_id text,
  google_calendar_id text,
  google_event_link text,
  created_at timestamptz not null default now()
);
create index meeting_calendar_events_calendar_dates_idx on public.meeting_calendar_events(calendar_id,start_date,end_date);
create index meeting_calendar_events_assignee_idx on public.meeting_calendar_events(assigned_to);
create index meeting_calendar_events_creator_idx on public.meeting_calendar_events(created_by);
alter table public.meeting_calendar_events enable row level security;
revoke all on public.meeting_calendar_events from anon, authenticated;
grant select, insert, delete on public.meeting_calendar_events to authenticated;
grant update(title,start_date,end_date,time,location,notes,assigned_to,completed) on public.meeting_calendar_events to authenticated;
create policy meeting_events_read on public.meeting_calendar_events for select to authenticated using (
  exists(select 1 from public.meeting_calendars c where c.id=calendar_id)
);
create policy meeting_events_create on public.meeting_calendar_events for insert to authenticated with check (
  created_by=(select auth.uid()) and exists (
    select 1 from public.meeting_calendars c join public.profiles p on p.id=(select auth.uid())
    where c.id=calendar_id and p.is_active and p.account_status='approved'
      and (c.owner_id=p.id or (c.visibility='sector' and c.sector=p.sector))
      and exists(select 1 from public.profiles assignee where assignee.id=assigned_to and assignee.is_active and assignee.account_status='approved'
        and ((c.visibility='personal' and assignee.id=c.owner_id) or (c.visibility='sector' and assignee.sector=c.sector)))
  )
);
create policy meeting_events_update on public.meeting_calendar_events for update to authenticated using (
  exists(select 1 from public.meeting_calendars c join public.profiles p on p.id=(select auth.uid())
    where c.id=calendar_id and (c.owner_id=p.id or created_by=p.id or (c.visibility='sector' and (p.role='admin' or (p.role='gerente' and p.sector=c.sector)))))
) with check (
  exists(select 1 from public.meeting_calendars c where c.id=calendar_id
    and exists(select 1 from public.profiles assignee where assignee.id=assigned_to and assignee.is_active and assignee.account_status='approved'
      and ((c.visibility='personal' and assignee.id=c.owner_id) or (c.visibility='sector' and assignee.sector=c.sector))))
);
create policy meeting_events_delete on public.meeting_calendar_events for delete to authenticated using (
  exists(select 1 from public.meeting_calendars c join public.profiles p on p.id=(select auth.uid())
    where c.id=calendar_id and (c.owner_id=p.id or created_by=p.id or (c.visibility='sector' and (p.role='admin' or (p.role='gerente' and p.sector=c.sector)))))
);
