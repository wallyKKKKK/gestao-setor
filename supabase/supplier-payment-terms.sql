create extension if not exists pg_trgm;

create table if not exists public.supplier_payment_terms (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null unique,
  payment_terms text not null default '',
  category text not null default 'Geral',
  region text not null default 'PA',
  min_order_value numeric(12, 2) not null default 0,
  condition_notes text not null default '',
  contact_name text not null default '',
  phone text not null default '',
  email text not null default '',
  tax_id text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists supplier_payment_terms_name_idx
on public.supplier_payment_terms (supplier_name);

create index if not exists supplier_payment_terms_category_idx
on public.supplier_payment_terms (category);

create index if not exists supplier_payment_terms_name_trgm_idx
on public.supplier_payment_terms using gin (supplier_name gin_trgm_ops);

create index if not exists supplier_payment_terms_category_trgm_idx
on public.supplier_payment_terms using gin (category gin_trgm_ops);

create index if not exists supplier_payment_terms_condition_notes_trgm_idx
on public.supplier_payment_terms using gin (condition_notes gin_trgm_ops);

create or replace function public.set_supplier_payment_terms_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists supplier_payment_terms_updated_at on public.supplier_payment_terms;
create trigger supplier_payment_terms_updated_at
before update on public.supplier_payment_terms
for each row execute function public.set_supplier_payment_terms_updated_at();

alter table public.supplier_payment_terms enable row level security;

drop policy if exists "Purchasing team can read supplier terms" on public.supplier_payment_terms;
create policy "Purchasing team can read supplier terms"
on public.supplier_payment_terms
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

drop policy if exists "Purchasing team can insert supplier terms" on public.supplier_payment_terms;
create policy "Purchasing team can insert supplier terms"
on public.supplier_payment_terms
for insert
to authenticated
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

drop policy if exists "Purchasing team can update supplier terms" on public.supplier_payment_terms;
create policy "Purchasing team can update supplier terms"
on public.supplier_payment_terms
for update
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

drop policy if exists "Purchasing team can delete supplier terms" on public.supplier_payment_terms;
create policy "Purchasing team can delete supplier terms"
on public.supplier_payment_terms
for delete
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

insert into public.supplier_payment_terms
  (supplier_name, payment_terms, category, region, min_order_value, condition_notes, sort_order)
values
  ('BTM', '21 / 28', 'Geral', 'PA', 0, '', 1),
  ('EBD', '20 / 27', 'Geral', 'PA', 0, '', 2),
  ('FLAMBOYANT', '28', 'Geral', 'PA', 0, '', 3),
  ('FRIBEL', '14 / 21 / 28', 'Geral', 'PA', 0, '', 4),
  ('MEGA', '28 / 35 / 45', 'Geral', 'PA', 0, '', 5),
  ('NESTLE', '21', 'Alimentos', 'PA', 0, '', 6),
  ('OLINDA', '14 / 21', 'Geral', 'PA', 0, '', 7),
  ('MATEUS', '22 / 32 / 42', 'Geral', 'PA', 0, '', 8),
  ('NAZARIA', '30 / 60 / 90', 'Geral', 'PA', 0, '', 9),
  ('NAZARIA NESTLE', '30', 'Alimentos', 'PA', 0, '', 10),
  ('MARTINS', '30 / 45 / 60', 'Geral', 'PA', 0, '', 11),
  ('CONDOR', '49 / 56 / 63', 'Geral', 'PA', 0, '', 12),
  ('JC DISTRIBUICAO', '7 / 14 / 21', 'Geral', 'PA', 0, '', 13),
  ('PANPHARMA', '45', 'Medicamentos', 'PA', 0, '', 14),
  ('CENTROFARMA', '20 / 40 / 60', 'Medicamentos', 'PA', 0, '', 15),
  ('DISMELO', '30 / 40 / 50', 'Geral', 'PA', 600, 'Maior de R$ 600. Menor de R$ 600: 35 dias.', 16),
  ('DISTRIMIX', '30 / 40 / 50', 'Geral', 'PA', 600, 'Maior de R$ 600. Menor de R$ 600: 35 dias.', 17),
  ('OKAJIMA', '21 / 28 / 35', 'Mix', 'PA', 300, 'Mix: 21/28/35. Fraldas: 30/40/50. Menor de R$ 300: 21 dias.', 18),
  ('SUPERGIRO', '28 / 35 / 42', 'Geral', 'PA', 0, '', 19),
  ('RIO AZUL', '28 / 35 / 42', 'Geral', 'PA', 0, '', 20),
  ('BIO EXTRATUS', '30 / 45', 'Perfumaria', 'PA', 0, 'Regra +: 30 / 45 / 60.', 21),
  ('HASKELL', '30 / 45 / 60', 'Perfumaria', 'PA', 0, '', 22),
  ('INOAR', '50 / 60', 'Perfumaria', 'PA', 0, '', 23),
  ('BELLIZ', '45 / 60 / 75', 'Perfumaria', 'PA', 0, '', 24),
  ('DERMATIVE', '30 / 45 / 60', 'Perfumaria', 'PA', 0, '', 25),
  ('BIOCLEAN CERA', '30 / 40 / 50', 'Perfumaria', 'PA', 0, '', 26),
  ('SALON LINE', '45 / 60 / 75', 'Perfumaria', 'PA', 0, '', 27),
  ('LABORENE', '40 / 50 / 60', 'Perfumaria', 'PA', 0, '', 28),
  ('CCM', '50 / 60 / 70', 'Geral', 'PA', 0, '', 29),
  ('DISTRI. IANETAMA', '30', 'Geral', 'PA', 0, '', 30),
  ('MATTEL', '30 / 60 / 90', 'Infantil', 'PA', 0, '', 31),
  ('LOLY', '49 / 63 / 77', 'Infantil', 'PA', 0, '', 32),
  ('PHILIPS AVENT', '30 / 60 / 90', 'Infantil', 'PA', 0, '', 33),
  ('MOAS BUBA', '30 / 60 / 90', 'Infantil', 'PA', 0, '', 34),
  ('CIMED', '30 / 60 / 90 / 120', 'Medicamentos', 'PA', 0, '', 35),
  ('MAM BABY', 'PA: 25 / 35 / 42 / 49 | MT: 40 / 70 / 90', 'Infantil', 'PA/MT', 0, 'Fornecedor via Centrofarma.', 36),
  ('NUTRIEX', '45 / 60 / 75', 'Geral', 'PA', 0, '', 37)
on conflict (supplier_name) do update set
  payment_terms = excluded.payment_terms,
  category = excluded.category,
  region = excluded.region,
  min_order_value = excluded.min_order_value,
  condition_notes = excluded.condition_notes,
  sort_order = excluded.sort_order;
