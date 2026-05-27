alter table public.profiles
add column if not exists account_status text;

alter table public.profiles
add column if not exists is_active boolean not null default true;

update public.profiles
set account_status = 'approved'
where account_status is null;

alter table public.profiles
alter column account_status set default 'pending';

alter table public.profiles
alter column account_status set not null;

alter table public.profiles
drop constraint if exists profiles_account_status_check;

alter table public.profiles
add constraint profiles_account_status_check
check (account_status in ('pending', 'approved', 'rejected'));
