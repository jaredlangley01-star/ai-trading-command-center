begin;

-- Idempotently guarantee the owner configuration fields consumed by both
-- Vercel and the Railway trading worker exist in production.
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

-- Preserve the existing owner-scoped policy. Recreate only if it is absent.
alter table auto_trader_config enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'auto_trader_config'
      and policyname = 'Owners manage Auto Trader configuration'
  ) then
    create policy "Owners manage Auto Trader configuration"
      on auto_trader_config for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

insert into schema_migrations(version)
values ('202608200003_trade_018_1_paper_test_persistence_hotfix')
on conflict(version) do nothing;

commit;
