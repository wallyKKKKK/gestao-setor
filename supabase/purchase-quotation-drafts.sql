create table public.purchase_quotation_drafts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision integer not null default 1 check (revision > 0),
  draft jsonb not null,
  constraint purchase_quotation_draft_size check (octet_length(draft::text) <= 20000000),
  constraint purchase_quotation_draft_shape check (
    jsonb_typeof(draft) = 'object'
    and draft ?& array['links', 'chosenCosts']
    and jsonb_typeof(draft -> 'links') = 'object'
    and jsonb_typeof(draft -> 'chosenCosts') = 'object'
    and (
      not (draft ? 'request') or (
        jsonb_typeof(draft -> 'request' -> 'name') is not distinct from 'string'
        and jsonb_typeof(draft -> 'request' -> 'rows') is not distinct from 'array'
      )
    )
    and (
      not (draft ? 'costs') or (
        jsonb_typeof(draft -> 'costs' -> 'name') is not distinct from 'string'
        and jsonb_typeof(draft -> 'costs' -> 'rows') is not distinct from 'array'
        and jsonb_typeof(draft -> 'costs' -> 'issues') is not distinct from 'array'
        and jsonb_typeof(draft -> 'costs' -> 'transfers') is not distinct from 'number'
      )
    )
  )
);

alter table public.purchase_quotation_drafts enable row level security;
revoke all on public.purchase_quotation_drafts from public, anon, authenticated;
grant select, insert on public.purchase_quotation_drafts to authenticated;
grant update (draft, revision) on public.purchase_quotation_drafts to authenticated;

create policy quotation_drafts_owner
on public.purchase_quotation_drafts for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy quotation_drafts_purchasing
on public.purchase_quotation_drafts as restrictive for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active = true
      and p.account_status = 'approved'
      and (p.role = 'admin' or lower(trim(p.sector)) like 'compras%')
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active = true
      and p.account_status = 'approved'
      and (p.role = 'admin' or lower(trim(p.sector)) like 'compras%')
  )
);
