create table if not exists public.erp_inventory_purchase_suspensions (
  id uuid primary key default gen_random_uuid(),
  branch_code text not null,
  ean text not null,
  is_suspended boolean not null default true,
  reason text not null default '',
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_inventory_purchase_suspensions_branch_ean_key unique (branch_code, ean)
);

create index if not exists erp_inventory_purchase_suspensions_branch_idx
  on public.erp_inventory_purchase_suspensions (branch_code);

create index if not exists erp_inventory_purchase_suspensions_ean_idx
  on public.erp_inventory_purchase_suspensions (ean);

create index if not exists erp_inventory_purchase_suspensions_active_idx
  on public.erp_inventory_purchase_suspensions (is_suspended)
  where is_suspended = true;

create or replace function public.set_erp_inventory_purchase_suspensions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_erp_inventory_purchase_suspensions_updated_at on public.erp_inventory_purchase_suspensions;
create trigger trg_erp_inventory_purchase_suspensions_updated_at
before update on public.erp_inventory_purchase_suspensions
for each row execute function public.set_erp_inventory_purchase_suspensions_updated_at();

alter table public.erp_inventory_purchase_suspensions enable row level security;

drop policy if exists "erp_inventory_purchase_suspensions_select" on public.erp_inventory_purchase_suspensions;
create policy "erp_inventory_purchase_suspensions_select"
on public.erp_inventory_purchase_suspensions
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.is_active, true) = true
      and coalesce(p.account_status, 'approved') = 'approved'
  )
);

drop policy if exists "erp_inventory_purchase_suspensions_manage" on public.erp_inventory_purchase_suspensions;
create policy "erp_inventory_purchase_suspensions_manage"
on public.erp_inventory_purchase_suspensions
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.is_active, true) = true
      and coalesce(p.account_status, 'approved') = 'approved'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.is_active, true) = true
      and coalesce(p.account_status, 'approved') = 'approved'
  )
);