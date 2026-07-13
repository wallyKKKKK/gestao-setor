alter table public.tasks
add column if not exists priority text default 'normal';

update public.tasks
set priority = 'normal'
where priority is null
   or lower(trim(priority)) not in ('alta', 'normal', 'baixa');

update public.tasks
set priority = lower(trim(priority))
where priority <> lower(trim(priority));

alter table public.tasks
alter column priority set default 'normal';

alter table public.tasks
alter column priority set not null;

alter table public.tasks
drop constraint if exists tasks_priority_check;

alter table public.tasks
add constraint tasks_priority_check
check (priority in ('alta', 'normal', 'baixa'));

create index if not exists tasks_priority_idx
on public.tasks (priority);
