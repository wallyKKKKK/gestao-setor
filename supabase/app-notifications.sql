create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  type text not null default 'info',
  actor_id uuid references auth.users(id) on delete set null,
  recipient_id uuid references auth.users(id) on delete cascade,
  sector text,
  entity_type text,
  entity_id text,
  created_at timestamptz not null default now()
);

create index if not exists app_notifications_created_at_idx
on public.app_notifications (created_at desc);

create index if not exists app_notifications_recipient_id_idx
on public.app_notifications (recipient_id);

create index if not exists app_notifications_sector_idx
on public.app_notifications (sector);

alter table public.app_notifications enable row level security;

drop policy if exists "Authenticated users can create app notifications" on public.app_notifications;
create policy "Authenticated users can create app notifications"
on public.app_notifications
for insert
to authenticated
with check (auth.uid() = actor_id);

drop policy if exists "Users can read relevant app notifications" on public.app_notifications;
create policy "Users can read relevant app notifications"
on public.app_notifications
for select
to authenticated
using (
  recipient_id = auth.uid()
  or recipient_id is null
  and exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (
        profiles.role = 'admin'
        or app_notifications.sector is null
        or app_notifications.sector = 'Geral'
        or profiles.sector = app_notifications.sector
      )
  )
);
