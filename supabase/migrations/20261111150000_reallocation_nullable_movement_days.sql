alter table public.reallocation_stock_items
  alter column last_sale_days drop not null,
  alter column last_sale_days drop default,
  alter column last_purchase_days drop not null,
  alter column last_purchase_days drop default;
