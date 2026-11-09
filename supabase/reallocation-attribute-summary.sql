-- Return one JSON value so PostgREST's row limit cannot truncate distinct attributes.
create function public.reallocation_product_attribute_summary(attribute_field text)
returns jsonb
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if attribute_field is null or attribute_field not in ('manufacturer', 'classification') then
    raise exception 'Invalid product attribute' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('value', grouped.value, 'count', grouped.total)), '[]'::jsonb)
  into result
  from (
    select btrim(case attribute_field when 'manufacturer' then manufacturer else classification end) as value, count(*) as total
    from public.reallocation_products
    where nullif(btrim(case attribute_field when 'manufacturer' then manufacturer else classification end), '') is not null
    group by 1
  ) grouped;
  return result;
end;
$$;
revoke all on function public.reallocation_product_attribute_summary(text) from public, anon, authenticated;
grant execute on function public.reallocation_product_attribute_summary(text) to service_role;
