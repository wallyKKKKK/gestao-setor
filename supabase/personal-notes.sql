create table public.personal_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '' check (length(title) <= 200),
  content text not null default '' check (length(content) <= 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index personal_notes_user_updated_idx on public.personal_notes (user_id, updated_at desc);
alter table public.personal_notes enable row level security;
revoke all on public.personal_notes from anon, authenticated;
grant select, insert, update, delete on public.personal_notes to authenticated;
create policy notes_select on public.personal_notes for select to authenticated using ((select auth.uid()) = user_id);
create policy notes_insert on public.personal_notes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy notes_update on public.personal_notes for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy notes_delete on public.personal_notes for delete to authenticated using ((select auth.uid()) = user_id);
