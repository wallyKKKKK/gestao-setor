-- Allows pre-vencidos rules that match only by expiration period, regardless of product attributes.
alter table public.expiring_discount_rules
  drop constraint if exists expiring_discount_rules_scope_type_check;

alter table public.expiring_discount_rules
  add constraint expiring_discount_rules_scope_type_check
  check (scope_type in ('product', 'manufacturer', 'line', 'department', 'category', 'classification', 'validity'));
