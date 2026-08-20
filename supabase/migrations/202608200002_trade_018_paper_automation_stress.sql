-- TRADE-018: owner-controlled PAPER automation stress testing.
alter table auto_trader_config add column if not exists paper_test_mode boolean not null default false;
alter table auto_trader_config add column if not exists paper_test_target_auto_positions integer not null default 8 check (paper_test_target_auto_positions between 1 and 100);
alter table auto_trader_config add column if not exists paper_big_money_test_mode boolean not null default false;
alter table auto_trader_config add column if not exists paper_test_target_big_money_positions integer not null default 2 check (paper_test_target_big_money_positions between 0 and 100);
alter table auto_trader_config add column if not exists paper_big_money_auto_approve_test boolean not null default false;
alter table auto_trader_config add column if not exists paper_test_min_opportunity_score numeric not null default 60 check (paper_test_min_opportunity_score between 0 and 100);
alter table auto_trader_config add column if not exists paper_test_min_confidence numeric not null default 50 check (paper_test_min_confidence between 0 and 100);
alter table auto_trader_config add column if not exists paper_test_max_position_size numeric not null default 1000 check (paper_test_max_position_size > 0);
alter table auto_trader_config add column if not exists paper_test_max_risk_per_trade numeric not null default 100 check (paper_test_max_risk_per_trade > 0);
alter table auto_trader_config add column if not exists paper_test_max_daily_trades integer not null default 30 check (paper_test_max_daily_trades > 0);
alter table auto_trader_config add column if not exists paper_test_universe text[] not null default array['AAPL','MSFT','NVDA','AMD','AMZN','META','GOOGL','TSLA','SPY','QQQ','NFLX','IWM'];

alter table paper_execution_requests add column if not exists paper_test_mode boolean not null default false;
alter table paper_execution_requests add column if not exists test_slot integer;
alter table paper_execution_requests add column if not exists candidate_rank integer;
alter table paper_execution_requests add column if not exists selection_reason text;
alter table paper_execution_requests add column if not exists test_thresholds jsonb not null default '{}'::jsonb;
alter table paper_positions add column if not exists paper_test_mode boolean not null default false;
alter table paper_positions add column if not exists test_slot integer;
alter table completed_paper_trades add column if not exists paper_test_mode boolean not null default false;
alter table completed_paper_trades add column if not exists test_slot integer;

create table if not exists paper_automation_test_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cycle_key text not null,
  status text not null check (status in ('OFF','WAITING_FOR_SESSION','SCANNING','TARGET_REACHED','BLOCKED')),
  target_auto_positions integer not null,
  confirmed_auto_positions integer not null default 0,
  pending_auto_orders integer not null default 0,
  target_big_money_positions integer not null default 0,
  confirmed_big_money_positions integer not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  strategy_coverage jsonb not null default '{}'::jsonb,
  symbol_coverage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(user_id, cycle_key)
);
alter table paper_automation_test_cycles enable row level security;
create policy "Owners read PAPER test cycles" on paper_automation_test_cycles for select using (auth.uid() = user_id);
create index if not exists paper_test_cycles_owner_created_idx on paper_automation_test_cycles(user_id, created_at desc);

insert into schema_migrations(version)
values ('202608200002_trade_018_paper_automation_stress')
on conflict (version) do nothing;
