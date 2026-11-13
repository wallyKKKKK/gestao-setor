alter table public.expiring_discount_rules
  add column rule_type text
  constraint expiring_discount_rules_rule_type_check check (
    rule_type in ('general', 'specific') and (rule_type <> 'specific' or scope_type <> 'validity')
  );
