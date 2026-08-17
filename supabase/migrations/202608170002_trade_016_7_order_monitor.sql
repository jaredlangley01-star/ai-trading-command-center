begin;

alter table orders
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists limit_price numeric,
  add column if not exists classification text
    check (classification in ('BIG','SMALL','STANDARD','MANUAL')),
  add column if not exists filled_quantity numeric not null default 0,
  add column if not exists average_fill_price numeric,
  add column if not exists error_reason text;

alter table paper_execution_requests
  add column if not exists broker_acknowledged_at timestamptz,
  add column if not exists filled_at timestamptz,
  add column if not exists filled_quantity numeric not null default 0,
  add column if not exists average_fill_price numeric,
  add column if not exists position_id uuid references paper_positions(id),
  add column if not exists completed_trade_id uuid references completed_paper_trades(id),
  add column if not exists journal_entry_id uuid references journal_entries(id);

alter table paper_positions
  add column if not exists entry_order_id uuid references orders(id);

alter table completed_paper_trades
  add column if not exists entry_order_id uuid references orders(id);

alter table journal_entries
  add column if not exists completed_paper_trade_id uuid references completed_paper_trades(id);

create index if not exists paper_execution_requests_owner_status_updated_idx
  on paper_execution_requests(user_id,status,updated_at desc);
create index if not exists orders_owner_updated_idx
  on orders(user_id,updated_at desc);

insert into schema_migrations(version)
values ('202608170002_trade_016_7_order_monitor')
on conflict (version) do nothing;

commit;
