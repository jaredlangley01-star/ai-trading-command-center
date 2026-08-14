alter table backtests add column if not exists job_key text;
alter table backtests add column if not exists configuration jsonb not null default '{}'::jsonb;
alter table backtests add column if not exists strategy_name text;
alter table backtests add column if not exists strategy_version text not null default 'TRADE-012';
alter table backtests add column if not exists data_source text;
alter table backtests add column if not exists data_timeframe text;
alter table backtests add column if not exists period_start timestamptz;
alter table backtests add column if not exists period_end timestamptz;
alter table backtests add column if not exists assumptions jsonb not null default '{}'::jsonb;
alter table backtests add column if not exists equity_curve jsonb not null default '[]'::jsonb;
alter table backtests add column if not exists drawdown_curve jsonb not null default '[]'::jsonb;
alter table backtests add column if not exists progress integer not null default 0 check (progress between 0 and 100);
alter table backtests add column if not exists error text;
alter table backtests add column if not exists started_at timestamptz;
alter table backtests add column if not exists completed_at timestamptz;
create unique index if not exists backtests_job_key_idx on backtests(user_id, job_key) where job_key is not null;

create table if not exists backtest_trades (
  id uuid primary key default gen_random_uuid(),
  backtest_id uuid not null references backtests(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  trade_index integer not null,
  symbol text not null,
  strategy text not null,
  direction text not null check (direction in ('BUY','SELL')),
  entry_timestamp timestamptz not null,
  entry_price numeric not null,
  exit_timestamp timestamptz not null,
  exit_price numeric not null,
  quantity numeric not null,
  stop_price numeric not null,
  target_price numeric not null,
  gross_pl numeric not null,
  costs numeric not null,
  net_pl numeric not null,
  return_pct numeric not null,
  exit_reason text not null,
  duration_ms bigint not null,
  unique (backtest_id, trade_index)
);
alter table backtest_trades enable row level security;
create policy "Owners read own backtest trades" on backtest_trades for select using (auth.uid() = user_id);
create index if not exists backtest_owner_created_idx on backtests(user_id, created_at desc);

