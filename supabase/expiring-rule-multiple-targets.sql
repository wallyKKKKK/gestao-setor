alter table public.expiring_discount_rules
  add column scope_values text[] not null default '{}',
  add constraint expiring_rules_scope_values_limit check (cardinality(scope_values) <= 5000 and array_position(scope_values, null) is null);
