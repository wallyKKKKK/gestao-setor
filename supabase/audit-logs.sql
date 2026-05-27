create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  actor_name text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  entity_title text,
  sector text not null default 'Geral',
  details text,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx
on public.audit_logs (created_at desc);

create index if not exists audit_logs_actor_id_idx
on public.audit_logs (actor_id);

alter table public.audit_logs enable row level security;

drop policy if exists "Authenticated users can insert audit logs" on public.audit_logs;
create policy "Authenticated users can insert audit logs"
on public.audit_logs
for insert
to authenticated
with check (auth.uid() = actor_id);

drop policy if exists "Admins can read audit logs" on public.audit_logs;
create policy "Admins can read audit logs"
on public.audit_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.is_active = true
      and profiles.account_status = 'approved'
  )
);
