-- Security hardening baseline for core app tables.
-- Safe to run more than once. It does not delete rows.

alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.task_history enable row level security;
alter table public.announcements enable row level security;

-- Keep old accounts usable if profile-account-controls.sql was not run yet.
update public.profiles
set account_status = 'approved'
where account_status is null;

update public.profiles
set is_active = true
where is_active is null;

-- Helper functions avoid recursive RLS checks on public.profiles policies.
create or replace function public.current_user_is_approved()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.is_active, true) = true
      and coalesce(p.account_status, 'approved') = 'approved'
  );
$$;

create or replace function public.current_user_is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.is_active, true) = true
      and coalesce(p.account_status, 'approved') = 'approved'
      and p.role = 'admin'
  );
$$;

create or replace function public.current_user_is_manager_or_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.is_active, true) = true
      and coalesce(p.account_status, 'approved') = 'approved'
      and p.role in ('admin', 'gerente')
  );
$$;

grant execute on function public.current_user_is_approved() to authenticated;
grant execute on function public.current_user_is_admin() to authenticated;
grant execute on function public.current_user_is_manager_or_admin() to authenticated;

-- Profiles: the user can read own profile; approved users can read the team list.
drop policy if exists "profiles_select_self_or_approved_team" on public.profiles;
create policy "profiles_select_self_or_approved_team"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.current_user_is_approved()
);

drop policy if exists "profiles_no_direct_insert" on public.profiles;
create policy "profiles_no_direct_insert"
on public.profiles
for insert
to authenticated
with check (false);

-- Profile updates should go through /api/profiles; direct client updates are admin-only.
drop policy if exists "profiles_update_self_name_only_or_admin" on public.profiles;
drop policy if exists "admins_can_update_profiles" on public.profiles;
create policy "admins_can_update_profiles"
on public.profiles
for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

-- Tasks: keep the current collaborative workflow, but block pending/inactive users at RLS level.
drop policy if exists "approved_users_can_read_tasks" on public.tasks;
create policy "approved_users_can_read_tasks"
on public.tasks
for select
to authenticated
using (public.current_user_is_approved());

drop policy if exists "approved_users_can_create_tasks" on public.tasks;
create policy "approved_users_can_create_tasks"
on public.tasks
for insert
to authenticated
with check (public.current_user_is_approved());

drop policy if exists "approved_users_can_update_tasks" on public.tasks;
create policy "approved_users_can_update_tasks"
on public.tasks
for update
to authenticated
using (public.current_user_is_approved())
with check (public.current_user_is_approved());

drop policy if exists "managers_can_delete_tasks" on public.tasks;
create policy "managers_can_delete_tasks"
on public.tasks
for delete
to authenticated
using (public.current_user_is_manager_or_admin());

-- Task history: append-only for approved users; visible to approved users.
drop policy if exists "approved_users_can_read_task_history" on public.task_history;
create policy "approved_users_can_read_task_history"
on public.task_history
for select
to authenticated
using (public.current_user_is_approved());

drop policy if exists "approved_users_can_insert_task_history" on public.task_history;
create policy "approved_users_can_insert_task_history"
on public.task_history
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.current_user_is_approved()
);

-- Announcements: approved users can read; admins/managers can create and remove.
drop policy if exists "approved_users_can_read_announcements" on public.announcements;
create policy "approved_users_can_read_announcements"
on public.announcements
for select
to authenticated
using (public.current_user_is_approved());

drop policy if exists "managers_can_manage_announcements" on public.announcements;
create policy "managers_can_manage_announcements"
on public.announcements
for all
to authenticated
using (public.current_user_is_manager_or_admin())
with check (public.current_user_is_manager_or_admin());