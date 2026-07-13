create extension if not exists pg_trgm;

create table if not exists public.purchase_assistant_imports (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_file text not null default '',
  source_type text not null default '',
  columns text[] not null default '{}',
  row_count integer not null default 0,
  is_active boolean not null default true,
  imported_by uuid references public.profiles(id),
  imported_at timestamptz not null default now()
);

create table if not exists public.purchase_assistant_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.purchase_assistant_imports(id) on delete cascade,
  row_number integer not null,
  row_data jsonb not null default '{}'::jsonb,
  detected_fields jsonb not null default '{}'::jsonb,
  normalized_text text not null default '',
  imported_at timestamptz not null default now()
);

create index if not exists purchase_assistant_imports_active_idx
on public.purchase_assistant_imports (is_active, imported_at desc);

create index if not exists purchase_assistant_import_rows_import_idx
on public.purchase_assistant_import_rows (import_id);

create index if not exists purchase_assistant_import_rows_detected_fields_idx
on public.purchase_assistant_import_rows using gin (detected_fields);

create index if not exists purchase_assistant_import_rows_search_idx
on public.purchase_assistant_import_rows using gin (normalized_text gin_trgm_ops);

alter table public.purchase_assistant_imports enable row level security;
alter table public.purchase_assistant_import_rows enable row level security;

drop policy if exists "Purchasing team can read assistant imports" on public.purchase_assistant_imports;
create policy "Purchasing team can read assistant imports"
on public.purchase_assistant_imports
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (
        profiles.role = 'admin'
        or lower(profiles.sector) like 'compras%'
      )
  )
);

drop policy if exists "Purchasing team can manage assistant imports" on public.purchase_assistant_imports;
create policy "Purchasing team can manage assistant imports"
on public.purchase_assistant_imports
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (
        profiles.role = 'admin'
        or lower(profiles.sector) like 'compras%'
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (
        profiles.role = 'admin'
        or lower(profiles.sector) like 'compras%'
      )
  )
);

drop policy if exists "Purchasing team can read assistant import rows" on public.purchase_assistant_import_rows;
create policy "Purchasing team can read assistant import rows"
on public.purchase_assistant_import_rows
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (
        profiles.role = 'admin'
        or lower(profiles.sector) like 'compras%'
      )
  )
);

drop policy if exists "Purchasing team can manage assistant import rows" on public.purchase_assistant_import_rows;
create policy "Purchasing team can manage assistant import rows"
on public.purchase_assistant_import_rows
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (
        profiles.role = 'admin'
        or lower(profiles.sector) like 'compras%'
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (
        profiles.role = 'admin'
        or lower(profiles.sector) like 'compras%'
      )
  )
);
