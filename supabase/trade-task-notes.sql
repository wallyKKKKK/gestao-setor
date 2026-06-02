drop table if exists public.trade_task_notes;

create table if not exists public.trade_task_notes (
  id uuid primary key default gen_random_uuid(),
  task_id bigint not null references public.tasks(id) on delete cascade,
  content text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists trade_task_notes_task_created_idx
on public.trade_task_notes (task_id, created_at desc);

alter table public.trade_task_notes enable row level security;

drop policy if exists "Trade notes are visible to task viewers" on public.trade_task_notes;
create policy "Trade notes are visible to task viewers"
on public.trade_task_notes
for select
to authenticated
using (
  exists (
    select 1
    from public.tasks t
    left join public.profiles p on p.id = auth.uid()
    where t.id = trade_task_notes.task_id
      and (
        p.role = 'admin'
        or t.sector = p.sector
        or t.assigned_to = auth.uid()
      )
  )
);

drop policy if exists "Authenticated users can create trade notes" on public.trade_task_notes;
create policy "Authenticated users can create trade notes"
on public.trade_task_notes
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists "Trade notes can be deleted by owner or leaders" on public.trade_task_notes;
create policy "Trade notes can be deleted by owner or leaders"
on public.trade_task_notes
for delete
to authenticated
using (
  created_by = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'gerente')
  )
);
