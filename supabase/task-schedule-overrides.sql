alter table public.tasks
add column if not exists schedule_override_date date,
add column if not exists schedule_override_type text;

alter table public.tasks
drop constraint if exists tasks_schedule_override_type_check;

alter table public.tasks
add constraint tasks_schedule_override_type_check
check (
  schedule_override_type is null
  or schedule_override_type in ('advanced', 'postponed')
);

create index if not exists tasks_schedule_override_date_idx
on public.tasks (schedule_override_date);
