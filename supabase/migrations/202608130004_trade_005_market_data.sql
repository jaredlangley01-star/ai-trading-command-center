-- TRADE-005: reconnect-safe paper order IDs and owner-scoped market-data state.
alter table orders add column if not exists client_order_id text;
create unique index if not exists orders_owner_client_order_idx
  on orders(user_id, client_order_id) where client_order_id is not null;

create table if not exists market_data_sync_state (
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null default 'IBKR_TWS_PAPER',
  status text not null check (status in ('DISCONNECTED','CONNECTING','MARKET_DATA_ACTIVE','AUTH_REQUIRED','ERROR')),
  last_quote_at timestamptz,
  last_history_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table market_data_sync_state enable row level security;
create policy "Owners manage their market data sync state"
  on market_data_sync_state for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table market_data_sync_state is
  'Owner-scoped paper market-data metadata only; never stores broker secrets.';
