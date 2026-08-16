begin;

create table if not exists paper_execution_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  client_order_id text not null,
  symbol text not null,
  direction text not null check (direction in ('BUY','SELL')),
  quantity numeric not null check (quantity > 0),
  order_type text not null check (order_type in ('MARKET','LIMIT')),
  limit_price numeric,
  stop_loss numeric,
  take_profit numeric,
  source text not null check (source in ('MANUAL','AUTO_TRADER','BIG_MONEY','POSITION_MANAGER')),
  status text not null default 'QUEUED' check (status in ('QUEUED','SUBMITTING','SUBMITTED','ACCEPTED','PARTIALLY_FILLED','FILLED','REJECTED','CANCELED','FAILED')),
  broker_order_id text,
  error_code text,
  error_message text,
  queued_at timestamptz not null default now(),
  worker_received_at timestamptz,
  broker_submitted_at timestamptz,
  completed_at timestamptz,
  risk_counted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, client_order_id)
);

create table if not exists paper_market_quotes (
  user_id uuid not null references profiles(id) on delete cascade,
  symbol text not null,
  bid numeric not null,
  ask numeric not null,
  last numeric not null,
  provider text not null check (provider = 'ALPACA'),
  feed text not null check (feed = 'IEX'),
  as_of timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, symbol)
);

alter table orders add column if not exists broker_order_id text;
create index if not exists paper_execution_requests_worker_idx
  on paper_execution_requests(status, queued_at);
create index if not exists orders_owner_broker_order_idx
  on orders(user_id, broker_order_id) where broker_order_id is not null;

alter table paper_execution_requests enable row level security;
alter table paper_market_quotes enable row level security;

drop policy if exists "Owners create PAPER execution requests" on paper_execution_requests;
create policy "Owners create PAPER execution requests"
  on paper_execution_requests for insert
  with check (auth.uid() = user_id and source = 'MANUAL' and status = 'QUEUED');
drop policy if exists "Owners read PAPER execution requests" on paper_execution_requests;
create policy "Owners read PAPER execution requests"
  on paper_execution_requests for select using (auth.uid() = user_id);
drop policy if exists "Owners read PAPER market quotes" on paper_market_quotes;
create policy "Owners read PAPER market quotes"
  on paper_market_quotes for select using (auth.uid() = user_id);

insert into schema_migrations (version)
values ('202608160003_trade_016_5_paper_execution_queue')
on conflict (version) do nothing;

commit;
