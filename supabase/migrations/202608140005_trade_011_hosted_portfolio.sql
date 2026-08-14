create table if not exists paper_portfolio_current (
  user_id uuid primary key references profiles(id) on delete cascade,
  account_id_masked text not null,
  equity numeric not null default 0,
  cash numeric not null default 0,
  buying_power numeric not null default 0,
  realized_pl_today numeric not null default 0,
  unrealized_pl numeric not null default 0,
  open_exposure numeric not null default 0,
  position_count integer not null default 0,
  open_order_count integer not null default 0,
  source text not null check (source = 'ALPACA_PAPER'),
  as_of timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists paper_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  broker_position_id text not null,
  symbol text not null,
  side text not null check (side in ('LONG','SHORT')),
  quantity numeric not null check (quantity >= 0),
  entry_price numeric not null,
  current_price numeric not null,
  market_value numeric not null,
  unrealized_pl numeric not null default 0,
  unrealized_pl_pct numeric not null default 0,
  stop_loss numeric,
  take_profit numeric,
  strategy_name text,
  status text not null default 'OPEN' check (status in ('OPEN','EXIT_PENDING','CLOSED')),
  exit_reason text,
  opened_at timestamptz,
  closed_at timestamptz,
  last_synced_at timestamptz not null,
  unique (user_id, broker_position_id)
);

create table if not exists paper_broker_fills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  broker_execution_id text not null,
  broker_order_id text not null,
  symbol text not null,
  side text not null check (side in ('BUY','SELL')),
  quantity numeric not null,
  price numeric not null,
  strategy_name text,
  executed_at timestamptz not null,
  raw jsonb not null default '{}'::jsonb,
  unique (user_id, broker_execution_id)
);

create table if not exists paper_position_exit_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  broker_position_id text not null,
  reason text not null check (reason in ('STOP_LOSS','TAKE_PROFIT')),
  client_order_id text not null unique,
  broker_order_id text,
  status text not null check (status in ('CLAIMED','SUBMITTED','FILLED','FAILED')),
  trigger_price numeric not null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, broker_position_id)
);

create table if not exists paper_portfolio_pl_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  sample_key text not null,
  equity numeric not null,
  realized_pl numeric not null,
  unrealized_pl numeric not null,
  open_exposure numeric not null,
  sampled_at timestamptz not null,
  unique (user_id, sample_key)
);

create index if not exists paper_positions_owner_status_idx on paper_positions(user_id, status);
create index if not exists paper_fills_owner_time_idx on paper_broker_fills(user_id, executed_at desc);
alter table paper_portfolio_current enable row level security;
alter table paper_positions enable row level security;
alter table paper_broker_fills enable row level security;
alter table paper_position_exit_claims enable row level security;
alter table paper_portfolio_pl_history enable row level security;
create policy "Owners read own PAPER portfolio" on paper_portfolio_current for select using (auth.uid() = user_id);
create policy "Owners read own PAPER positions" on paper_positions for select using (auth.uid() = user_id);
create policy "Owners read own PAPER fills" on paper_broker_fills for select using (auth.uid() = user_id);
create policy "Owners read own PAPER exit claims" on paper_position_exit_claims for select using (auth.uid() = user_id);
create policy "Owners read own PAPER P/L history" on paper_portfolio_pl_history for select using (auth.uid() = user_id);

