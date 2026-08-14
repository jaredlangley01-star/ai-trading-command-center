-- TRADE-008: durable owner-scoped PAPER Auto Trader workflow.
create table if not exists auto_trader_config (
  user_id uuid primary key references profiles(id) on delete cascade,
  enabled boolean not null default false,
  capital_allocation numeric not null default 25000 check (capital_allocation >= 0),
  maximum_trade_size numeric not null default 2500 check (maximum_trade_size >= 0),
  maximum_risk_per_trade numeric not null default 250 check (maximum_risk_per_trade >= 0),
  daily_loss_limit numeric not null default 750 check (daily_loss_limit >= 0),
  daily_profit_target numeric not null default 1000 check (daily_profit_target >= 0),
  maximum_trades_per_day integer not null default 8 check (maximum_trades_per_day >= 0),
  maximum_concurrent_positions integer not null default 4 check (maximum_concurrent_positions >= 0),
  minimum_strategy_score integer not null default 70 check (minimum_strategy_score between 0 and 100),
  allowed_strategies jsonb not null default '["Trend Following","Momentum","Breakout","Mean Reversion"]'::jsonb,
  allowed_assets jsonb not null default '["AAPL","NVDA","MSFT","AMZN"]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists auto_trader_daily_state (
  user_id uuid not null references profiles(id) on delete cascade,
  trading_date date not null default current_date,
  profit_loss numeric not null default 0,
  trades integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  deployed_capital numeric not null default 0,
  status text not null default 'PAUSED' check (status in ('ACTIVE','PAUSED','LOCKED','TARGET_REACHED')),
  lock_reason text,
  updated_at timestamptz not null default now(),
  primary key (user_id, trading_date)
);

create table if not exists automated_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  opportunity_key text not null,
  symbol text not null,
  direction text not null check (direction in ('BUY','SELL','NO_TRADE')),
  status text not null check (status in ('PROCESSING','EXECUTED','REJECTED','SKIPPED','REDUCED','LOCKED')),
  reason text not null,
  signal_score integer not null check (signal_score between 0 and 100),
  strategies jsonb not null default '[]'::jsonb,
  capital numeric not null default 0,
  maximum_planned_loss numeric not null default 0,
  entry_price numeric,
  stop_loss numeric,
  take_profit numeric,
  execution_source text not null check (execution_source in ('NONE','SIMULATED_PAPER','IBKR_PAPER')),
  broker_order_id text,
  opportunity_id uuid references strategy_opportunities(id),
  risk_decision_id uuid references risk_decisions(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, opportunity_key)
);

create table if not exists automated_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  automated_decision_id uuid not null unique references automated_decisions(id) on delete cascade,
  source text not null check (source in ('SIMULATED_PAPER','IBKR_PAPER')),
  broker_order_id text,
  result jsonb not null,
  executed_at timestamptz not null default now()
);

alter table positions add column if not exists automated_decision_id uuid references automated_decisions(id);
alter table orders add column if not exists automated_decision_id uuid references automated_decisions(id);
alter table journal_entries add column if not exists automated_decision_id uuid references automated_decisions(id);
create unique index if not exists positions_automated_decision_idx on positions(automated_decision_id) where automated_decision_id is not null;
create unique index if not exists orders_automated_decision_idx on orders(automated_decision_id) where automated_decision_id is not null;
create index if not exists automated_decisions_owner_time_idx on automated_decisions(user_id, created_at desc);

alter table auto_trader_config enable row level security;
alter table auto_trader_daily_state enable row level security;
alter table automated_decisions enable row level security;
alter table automated_executions enable row level security;
create policy "Owners manage Auto Trader configuration" on auto_trader_config for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Owners manage Auto Trader daily state" on auto_trader_daily_state for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Owners manage automated decisions" on automated_decisions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Owners manage automated executions" on automated_executions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table automated_decisions is 'PAPER-only explainable Auto Trader decisions with durable idempotency.';

create or replace function record_auto_trader_execution(p_user_id uuid, p_capital numeric)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is distinct from p_user_id then raise exception 'owner mismatch'; end if;
  insert into auto_trader_daily_state(user_id, trading_date, trades, deployed_capital, status)
  values (p_user_id, current_date, 1, p_capital, 'ACTIVE')
  on conflict (user_id, trading_date) do update set
    trades = auto_trader_daily_state.trades + 1,
    deployed_capital = auto_trader_daily_state.deployed_capital + p_capital,
    updated_at = now();
end;
$$;
