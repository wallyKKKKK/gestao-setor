alter table public.tasks
add column if not exists is_one_off boolean not null default false,
add column if not exists archived_at timestamptz;

create index if not exists tasks_archived_at_idx
on public.tasks (archived_at);

create index if not exists tasks_is_one_off_idx
on public.tasks (is_one_off);
