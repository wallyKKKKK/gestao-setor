create table public.app_sectors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 80 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  name_key text generated always as (
    lower(translate(regexp_replace(btrim(name), '\s+', ' ', 'g'),
      'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
      'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'))
  ) stored unique,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index app_sectors_created_by_idx on public.app_sectors (created_by);
alter table public.app_sectors enable row level security;
revoke all on public.app_sectors from anon, authenticated;
grant select, insert on public.app_sectors to authenticated;
create policy sectors_read on public.app_sectors for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_active and p.account_status = 'approved')
);
create policy sectors_create_admin on public.app_sectors for insert to authenticated with check (
  created_by = (select auth.uid()) and exists (
    select 1 from public.profiles p where p.id = (select auth.uid())
      and p.is_active and p.account_status = 'approved' and p.role = 'admin'
  )
);

-- Keep all existing sector assignments unchanged; only populate the new catalog.
insert into public.app_sectors (name, created_by) values
  ('Geral', null), ('Trade', null), ('Compras Perfumaria', null), ('Compras Medicamentos', null),
  ('Suplemento esportivo', null), ('Precificação', null), ('Logística', null)
on conflict (name_key) do nothing;
insert into public.app_sectors (name, created_by)
select distinct btrim(sector), null::uuid from public.profiles
where length(btrim(sector)) between 2 and 80 and sector !~ '[[:cntrl:]]'
on conflict (name_key) do nothing;
