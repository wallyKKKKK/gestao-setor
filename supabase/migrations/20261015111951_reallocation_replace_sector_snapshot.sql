alter table public.reallocation_stock_snapshots
  add column if not exists is_ready boolean not null default true;

create or replace function public.publish_reallocation_stock_snapshot(
  p_snapshot_id uuid, p_sector text, p_expected_rows integer
) returns bigint
language plpgsql security invoker set search_path = ''
as $$
declare
  v_ready boolean;
  v_count bigint;
  v_replaced bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('reallocation-stock:' || p_sector, 0));
  select is_ready into v_ready from public.reallocation_stock_snapshots
    where id = p_snapshot_id and sector = p_sector for update;
  if not found then raise exception 'Base de estoque nao encontrada no setor'; end if;
  if v_ready then return 0; end if;
  select count(*) into v_count from public.reallocation_stock_items where snapshot_id = p_snapshot_id;
  if p_expected_rows is null or p_expected_rows <= 0 or v_count <> p_expected_rows then
    raise exception 'Importacao incompleta: esperado %, encontrado %', p_expected_rows, v_count;
  end if;
  select count(*) into v_replaced
    from public.reallocation_stock_items i
    join public.reallocation_stock_snapshots s on s.id = i.snapshot_id
    where s.sector = p_sector and s.is_ready and s.id <> p_snapshot_id;
  -- Publication and cascading removal are committed together; pending uploads are untouched.
  delete from public.reallocation_stock_snapshots
    where sector = p_sector and is_ready and id <> p_snapshot_id;
  update public.reallocation_stock_snapshots
    set is_ready = true, imported_at = clock_timestamp(), notes = 'Base integral do setor ' || p_sector
    where id = p_snapshot_id;
  return v_replaced;
end;
$$;
revoke all on function public.publish_reallocation_stock_snapshot(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.publish_reallocation_stock_snapshot(uuid,text,integer) to service_role;
