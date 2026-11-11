begin;

create function public.apply_a7_product_catalog_20261110(p_rows jsonb, p_apply boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set statement_timeout = '55s'
as $$
declare
  changed integer;
  added integer;
  checked integer;
begin
  if p_apply is null or p_rows is null or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) <> 11467 then
    raise exception 'Unexpected size of reviewed batch';
  end if;

  create temporary table reviewed_a7_catalog_20261110 (
    erp_code text not null check (erp_code ~ '^[A-Za-z0-9]+$'),
    ean text primary key check (ean ~ '^[0-9]+$' and ean ~ '[1-9]'),
    description text not null check (btrim(description) <> ''),
    manufacturer text not null,
    classification text not null,
    search_text text not null,
    expected_id uuid unique,
    expected_updated_at timestamptz,
    check ((expected_id is null) = (expected_updated_at is null))
  ) on commit drop;

  insert into pg_temp.reviewed_a7_catalog_20261110
  select * from jsonb_to_recordset(p_rows) as v(
    erp_code text, ean text, description text, manufacturer text, classification text,
    search_text text, expected_id uuid, expected_updated_at timestamptz
  );
  analyze pg_temp.reviewed_a7_catalog_20261110;

  select count(*) filter (where expected_id is not null), count(*) filter (where expected_id is null)
  into changed, added
  from pg_temp.reviewed_a7_catalog_20261110;
  if changed <> 11210 or added <> 257 then
    raise exception 'Unexpected operation counts';
  end if;

  -- Readers stay available; concurrent writes cannot slip between the checks and the update.
  lock table public.reallocation_products in share row exclusive mode nowait;

  if exists (
    select 1 from pg_temp.reviewed_a7_catalog_20261110 v
    left join public.reallocation_products p on p.erp_code = v.erp_code and p.ean = v.ean
    where p.id is distinct from v.expected_id
       or p.updated_at is distinct from v.expected_updated_at
       or (v.expected_id is not null and (
            (btrim(v.manufacturer) = '' and btrim(p.manufacturer) <> '')
         or (btrim(v.classification) = '' and btrim(p.classification) <> '')
       ))
  ) or exists (
    select 1 from pg_temp.reviewed_a7_catalog_20261110 v
    join public.reallocation_products p on p.ean = v.ean and p.erp_code <> v.erp_code
  ) then
    raise exception 'The catalog changed after review; no rows were written';
  end if;

  if not p_apply then
    return jsonb_build_object('applied', false, 'updated', changed, 'inserted', added, 'verified', 0);
  end if;

  update public.reallocation_products p
  set description = v.description, manufacturer = v.manufacturer,
      classification = v.classification, search_text = v.search_text
  from pg_temp.reviewed_a7_catalog_20261110 v
  where p.id = v.expected_id;
  get diagnostics changed = row_count;

  insert into public.reallocation_products (erp_code, ean, description, manufacturer, classification, search_text, source_file)
  select erp_code, ean, description, manufacturer, classification, search_text,
    'Produtos_10112026.CSV + produtos .xlsx'
  from pg_temp.reviewed_a7_catalog_20261110 where expected_id is null;
  get diagnostics added = row_count;

  select count(*) into checked
  from pg_temp.reviewed_a7_catalog_20261110 v
  join public.reallocation_products p using (erp_code, ean)
  where (v.expected_id is null or p.id = v.expected_id)
    and (p.description, p.manufacturer, p.classification, p.search_text) =
        (v.description, v.manufacturer, v.classification, v.search_text);
  if changed <> 11210 or added <> 257 or checked <> 11467 then
    raise exception 'Verification failed; the transaction was canceled';
  end if;

  return jsonb_build_object('applied', true, 'updated', changed, 'inserted', added,
    'verified', checked, 'applied_at', now());
end;
$$;

revoke all on function public.apply_a7_product_catalog_20261110(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.apply_a7_product_catalog_20261110(jsonb, boolean) to service_role;

commit;
