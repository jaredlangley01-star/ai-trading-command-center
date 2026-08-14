begin;

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

-- A failed early TRADE-016 run may have recorded this version before creating
-- every object. Remove that premature marker inside this transaction and only
-- restore it after the complete schema and RLS policy set are established.
delete from schema_migrations
where version = '202608140010_trade_016_final_production';

alter table system_state
  add column if not exists active_environment text not null default 'PAPER'
  check (active_environment in ('PAPER', 'LIVE'));

create table if not exists trading_environment_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  environment text not null check (environment in ('PAPER', 'LIVE')),
  risk_settings jsonb not null default '{}',
  auto_trader_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (user_id, environment)
);

create table if not exists environment_switch_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  from_environment text not null,
  requested_environment text not null,
  result text not null,
  reason text,
  open_position_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists chart_preferences (
  user_id uuid primary key references profiles(id) on delete cascade,
  indicators jsonb not null default '[]',
  overlay_settings jsonb not null default '{}',
  watchlist jsonb not null default '["SPY","QQQ","AAPL","MSFT","NVDA"]',
  updated_at timestamptz not null default now()
);

create table if not exists chart_drawings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  symbol text not null,
  timeframe text not null,
  drawing_type text not null,
  geometry jsonb not null,
  style jsonb not null default '{}',
  label text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chart_drawings_owner_symbol_timeframe
  on chart_drawings (user_id, symbol, timeframe);

create table if not exists notification_worker_heartbeats (
  user_id uuid not null references profiles(id) on delete cascade,
  worker_id text not null,
  status text not null,
  last_seen_at timestamptz not null default now(),
  version text,
  metadata jsonb not null default '{}',
  primary key (user_id, worker_id)
);

alter table trading_environment_settings enable row level security;
alter table environment_switch_audit enable row level security;
alter table chart_preferences enable row level security;
alter table chart_drawings enable row level security;
alter table notification_worker_heartbeats enable row level security;

-- DROP POLICY is metadata-only and preserves all table data. Recreating each
-- policy makes clean and partially-applied runs converge on the exact
-- owner-scoped predicates required by TRADE-016.
drop policy if exists "Owners manage environment settings"
  on trading_environment_settings;
create policy "Owners manage environment settings"
  on trading_environment_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Owners read switch audit" on environment_switch_audit;
create policy "Owners read switch audit"
  on environment_switch_audit for select
  using (auth.uid() = user_id);

drop policy if exists "Owners manage chart preferences" on chart_preferences;
create policy "Owners manage chart preferences"
  on chart_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Owners manage chart drawings" on chart_drawings;
create policy "Owners manage chart drawings"
  on chart_drawings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Owners read notification heartbeat"
  on notification_worker_heartbeats;
create policy "Owners read notification heartbeat"
  on notification_worker_heartbeats for select
  using (auth.uid() = user_id);

insert into trading_environment_settings (
  user_id,
  environment,
  risk_settings,
  auto_trader_enabled
)
select id, 'PAPER', '{}', false from profiles
on conflict do nothing;

insert into trading_environment_settings (
  user_id,
  environment,
  risk_settings,
  auto_trader_enabled
)
select
  id,
  'LIVE',
  '{"maximumCapitalAllocation":5000,"maximumTradeSize":500,"maximumPlannedLossPerTrade":50,"dailyLossLimit":150,"maximumConcurrentPositions":1,"maximumPortfolioExposure":10,"minimumOpportunityScore":90,"minimumConfidence":85}',
  false
from profiles
on conflict do nothing;

insert into schema_migrations (version)
values ('202608140010_trade_016_final_production');

commit;
