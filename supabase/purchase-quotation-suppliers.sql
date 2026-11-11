begin;

create table public.purchase_quotation_suppliers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cnpj text not null check (cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  name text not null check (char_length(name) between 1 and 200),
  contact text not null default '',
  email text not null default '',
  whatsapp text not null default '',
  coverage text not null default '',
  minimum_order numeric(14,2) not null check (minimum_order >= 0),
  payment_days integer not null check (payment_days between 0 and 3650),
  unique (user_id, cnpj),
  unique (id, user_id)
);

create table public.purchase_quotation_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_revision integer not null check (draft_revision > 0),
  title text not null,
  buyer_items jsonb not null check (jsonb_typeof(buyer_items) = 'array'),
  supplier_items jsonb not null check (jsonb_typeof(supplier_items) = 'array'),
  created_at timestamptz not null default now(),
  unique (user_id, draft_revision),
  unique (id, user_id)
);

create table public.purchase_quotation_invites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  round_id uuid not null,
  supplier_id uuid not null,
  supplier_name text not null,
  minimum_order numeric(14,2) not null,
  default_payment_days integer not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  submitted_at timestamptz,
  proposal jsonb,
  revision integer not null default 0 check (revision >= 0),
  foreign key (round_id, user_id) references public.purchase_quotation_rounds (id, user_id) on delete cascade,
  foreign key (supplier_id, user_id) references public.purchase_quotation_suppliers (id, user_id) on delete cascade,
  unique (round_id, supplier_id)
);

create index purchase_quotation_invites_owner_date_idx on public.purchase_quotation_invites (user_id, created_at desc);
create index purchase_quotation_invites_supplier_idx on public.purchase_quotation_invites (supplier_id, user_id);

alter table public.purchase_quotation_suppliers enable row level security;
alter table public.purchase_quotation_rounds enable row level security;
alter table public.purchase_quotation_invites enable row level security;
revoke all on public.purchase_quotation_suppliers, public.purchase_quotation_rounds, public.purchase_quotation_invites from public, anon, authenticated;
grant select, insert, update on public.purchase_quotation_suppliers, public.purchase_quotation_rounds, public.purchase_quotation_invites to service_role;
grant select on public.purchase_quotation_drafts to service_role;

commit;
