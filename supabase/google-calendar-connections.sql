create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  scope text,
  token_type text,
  calendar_id text default 'primary',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.google_calendar_connections enable row level security;

drop policy if exists "Users can read own Google Calendar connection" on public.google_calendar_connections;
create policy "Users can read own Google Calendar connection"
on public.google_calendar_connections
for select
using (auth.uid() = user_id);

-- Writes are performed by server-side API routes with SUPABASE_SERVICE_ROLE_KEY.
