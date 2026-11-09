begin;

alter table public.expiring_discount_rules
  add column if not exists offer_config jsonb,
  alter column discount_value type numeric(14, 4),
  drop constraint if exists expiring_discount_rules_discount_type_check,
  add constraint expiring_discount_rules_discount_type_check
    check (discount_type in ('percent', 'fixed_price', 'half_cost_price', 'cost_percent_price', 'sale_percent_price',
      'buy_pay', 'quantity_discount', 'cost_markup', 'average_cost_markup', 'reference_price_markup'));

commit;
