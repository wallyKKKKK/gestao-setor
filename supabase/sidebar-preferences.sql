create table public.sidebar_preferences (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  sections text[] not null default '{}',
  updated_at timestamptz not null default now(),
  constraint sidebar_preferences_sections_valid check (
    cardinality(sections) <= 13 and sections <@ array['TAREFAS','REUNIAO','NOTAS','COMPRAS_IA','CADASTROS','ESTOQUE_ERP','PRECIFICACAO','PRE_VENCIDOS','PRAZOS','TRANSPORTE','BALACUBACO','AUDITORIA','USUARIOS']::text[]
  )
);
alter table public.sidebar_preferences enable row level security;
revoke all on public.sidebar_preferences from anon, authenticated;
grant select, insert, update, delete on public.sidebar_preferences to authenticated;
create policy sidebar_select on public.sidebar_preferences for select to authenticated using ((select auth.uid()) = user_id);
create policy sidebar_insert on public.sidebar_preferences for insert to authenticated with check ((select auth.uid()) = user_id);
create policy sidebar_update on public.sidebar_preferences for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy sidebar_delete on public.sidebar_preferences for delete to authenticated using ((select auth.uid()) = user_id);
