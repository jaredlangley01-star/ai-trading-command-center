-- TRADE-006: owner-scoped production PAPER risk state and decision ledger.
alter table risk_settings alter column settings set default
  '{"autoTraderEnabled":true,"autoTraderAllocatedCapital":25000,"maximumCapitalPerTrade":2500,"maximumRiskPerTrade":250,"dailyMaximumLoss":750,"dailyProfitTarget":1000,"maximumTradesPerDay":8,"maximumConcurrentPositions":4,"maximumPortfolioExposure":70,"maximumPortfolioDrawdown":12,"maximumExposurePerAsset":20,"bigMoneyApprovalThreshold":85}'::jsonb;
update risk_settings set settings =
  jsonb_build_object('maximumPortfolioExposure', 70) || settings;
alter table orders add column if not exists source text not null default 'MANUAL'
  check (source in ('MANUAL','AUTO_TRADER','BIG_MONEY'));
alter table positions add column if not exists source text not null default 'MANUAL'
  check (source in ('MANUAL','AUTO_TRADER','BIG_MONEY'));

create table if not exists daily_risk_state (
  user_id uuid not null references profiles(id) on delete cascade,
  trading_date date not null default current_date,
  profit_loss numeric not null default 0,
  trades_opened integer not null default 0 check (trades_opened >= 0),
  status text not null default 'NORMAL' check (status in ('NORMAL','DAILY_LOCK','SYSTEM_LOCK')),
  lock_reason text,
  updated_at timestamptz not null default now(),
  primary key (user_id, trading_date)
);

create table if not exists risk_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  client_order_id text,
  symbol text not null,
  source text not null check (source in ('MANUAL','AUTO_TRADER','BIG_MONEY')),
  decision text not null check (decision in ('APPROVED','REJECTED','REDUCE_SIZE','DAILY_LOCK','SYSTEM_LOCK')),
  reason text not null,
  requested_capital numeric not null,
  approved_capital numeric not null default 0,
  calculated_loss numeric not null default 0,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists risk_portfolio_state (
  user_id uuid primary key references profiles(id) on delete cascade,
  high_water_mark numeric not null default 0,
  current_value numeric not null default 0,
  drawdown_pct numeric not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists risk_decisions_owner_created_idx
  on risk_decisions(user_id, created_at desc);
alter table daily_risk_state enable row level security;
alter table risk_decisions enable row level security;
alter table risk_portfolio_state enable row level security;
create policy "Owners manage daily risk state" on daily_risk_state for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Owners read risk decisions" on risk_decisions for select
  using (auth.uid() = user_id);
create policy "Owners insert risk decisions" on risk_decisions for insert
  with check (auth.uid() = user_id);
create policy "Owners manage risk portfolio state" on risk_portfolio_state for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table risk_decisions is 'Immutable owner-scoped PAPER risk decisions.';

create or replace function record_paper_trade_open(p_user_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'owner mismatch';
  end if;
  insert into daily_risk_state (user_id, trading_date, trades_opened)
  values (p_user_id, current_date, 1)
  on conflict (user_id, trading_date) do update
    set trades_opened = daily_risk_state.trades_opened + 1,
        updated_at = now();
end;
$$;
