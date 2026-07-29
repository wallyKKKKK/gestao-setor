alter table public.tasks
  add column if not exists workflow_status text not null default 'pendente',
  add column if not exists workflow_started_by uuid null,
  add column if not exists workflow_started_by_name text null,
  add column if not exists workflow_started_at timestamptz null,
  add column if not exists workflow_blocked_reason text null;

update public.tasks
set workflow_status = case
  when status = 'concluido' then 'concluida'
  when workflow_status is null or workflow_status = '' then 'pendente'
  else workflow_status
end;

alter table public.tasks drop constraint if exists tasks_workflow_status_check;

alter table public.tasks
  add constraint tasks_workflow_status_check
  check (workflow_status in ('pendente', 'em_andamento', 'bloqueada', 'concluida'));

create index if not exists tasks_workflow_status_idx on public.tasks (workflow_status);
create index if not exists tasks_workflow_started_by_idx on public.tasks (workflow_started_by);
