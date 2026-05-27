alter table public.tasks
add column if not exists google_event_id text,
add column if not exists google_event_link text;

create index if not exists tasks_google_event_id_idx
on public.tasks (google_event_id);
