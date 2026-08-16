begin;

-- Converge only the required TRADE-016 objects. IF NOT EXISTS preserves every
-- existing table, row, index, and setting on already-complete databases.
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

-- Replacing policies is metadata-only and occurs inside this transaction. The
-- exact owner predicates are never broadened or disabled.
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

-- Record the historical version only after proving that the required schema
-- and owner-scoped RLS protections are present.
do $$
declare
  missing_objects text[] := '{}';
begin
  if to_regclass('public.schema_migrations') is null then
    raise exception 'TRADE-016 repair blocked: schema_migrations is missing';
  end if;

  if to_regclass('public.trading_environment_settings') is null then
    missing_objects := array_append(missing_objects, 'table trading_environment_settings');
  end if;
  if to_regclass('public.environment_switch_audit') is null then
    missing_objects := array_append(missing_objects, 'table environment_switch_audit');
  end if;
  if to_regclass('public.chart_preferences') is null then
    missing_objects := array_append(missing_objects, 'table chart_preferences');
  end if;
  if to_regclass('public.chart_drawings') is null then
    missing_objects := array_append(missing_objects, 'table chart_drawings');
  end if;
  if to_regclass('public.notification_worker_heartbeats') is null then
    missing_objects := array_append(missing_objects, 'table notification_worker_heartbeats');
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'system_state'
      and column_name = 'active_environment' and is_nullable = 'NO'
  ) then
    missing_objects := array_append(missing_objects, 'column system_state.active_environment');
  end if;

  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'trading_environment_settings'
      and column_name in ('id','user_id','environment','risk_settings','auto_trader_enabled','updated_at')
  ) <> 6 then
    missing_objects := array_append(missing_objects, 'columns trading_environment_settings');
  end if;
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'environment_switch_audit'
      and column_name in ('id','user_id','from_environment','requested_environment','result','reason','open_position_count','created_at')
  ) <> 8 then
    missing_objects := array_append(missing_objects, 'columns environment_switch_audit');
  end if;
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'chart_preferences'
      and column_name in ('user_id','indicators','overlay_settings','watchlist','updated_at')
  ) <> 5 then
    missing_objects := array_append(missing_objects, 'columns chart_preferences');
  end if;
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'chart_drawings'
      and column_name in ('id','user_id','symbol','timeframe','drawing_type','geometry','style','label','created_at','updated_at')
  ) <> 10 then
    missing_objects := array_append(missing_objects, 'columns chart_drawings');
  end if;
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_worker_heartbeats'
      and column_name in ('user_id','worker_id','status','last_seen_at','version','metadata')
  ) <> 6 then
    missing_objects := array_append(missing_objects, 'columns notification_worker_heartbeats');
  end if;

  if to_regclass('public.chart_drawings_owner_symbol_timeframe') is null then
    missing_objects := array_append(missing_objects, 'index chart_drawings_owner_symbol_timeframe');
  end if;

  if exists (
    select 1
    from (values
      ('trading_environment_settings'),
      ('environment_switch_audit'),
      ('chart_preferences'),
      ('chart_drawings'),
      ('notification_worker_heartbeats')
    ) as required(table_name)
    left join pg_class c on c.oid = to_regclass('public.' || required.table_name)
    where c.oid is null or not c.relrowsecurity
  ) then
    missing_objects := array_append(missing_objects, 'RLS enablement');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trading_environment_settings'
      and policyname = 'Owners manage environment settings' and cmd = 'ALL'
      and regexp_replace(qual, '\s', '', 'g') = '(auth.uid()=user_id)'
      and regexp_replace(with_check, '\s', '', 'g') = '(auth.uid()=user_id)'
  ) then
    missing_objects := array_append(missing_objects, 'policy Owners manage environment settings');
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'environment_switch_audit'
      and policyname = 'Owners read switch audit' and cmd = 'SELECT'
      and regexp_replace(qual, '\s', '', 'g') = '(auth.uid()=user_id)'
  ) then
    missing_objects := array_append(missing_objects, 'policy Owners read switch audit');
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chart_preferences'
      and policyname = 'Owners manage chart preferences' and cmd = 'ALL'
      and regexp_replace(qual, '\s', '', 'g') = '(auth.uid()=user_id)'
      and regexp_replace(with_check, '\s', '', 'g') = '(auth.uid()=user_id)'
  ) then
    missing_objects := array_append(missing_objects, 'policy Owners manage chart preferences');
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chart_drawings'
      and policyname = 'Owners manage chart drawings' and cmd = 'ALL'
      and regexp_replace(qual, '\s', '', 'g') = '(auth.uid()=user_id)'
      and regexp_replace(with_check, '\s', '', 'g') = '(auth.uid()=user_id)'
  ) then
    missing_objects := array_append(missing_objects, 'policy Owners manage chart drawings');
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notification_worker_heartbeats'
      and policyname = 'Owners read notification heartbeat' and cmd = 'SELECT'
      and regexp_replace(qual, '\s', '', 'g') = '(auth.uid()=user_id)'
  ) then
    missing_objects := array_append(missing_objects, 'policy Owners read notification heartbeat');
  end if;

  if cardinality(missing_objects) > 0 then
    raise exception 'TRADE-016 repair blocked; required schema is incomplete: %',
      array_to_string(missing_objects, ', ');
  end if;
end
$$;

-- Preserve all existing settings and add only missing per-owner environment rows.
insert into trading_environment_settings (
  user_id, environment, risk_settings, auto_trader_enabled
)
select id, 'PAPER', '{}', false from profiles
on conflict (user_id, environment) do nothing;

insert into trading_environment_settings (
  user_id, environment, risk_settings, auto_trader_enabled
)
select
  id,
  'LIVE',
  '{"maximumCapitalAllocation":5000,"maximumTradeSize":500,"maximumPlannedLossPerTrade":50,"dailyLossLimit":150,"maximumConcurrentPositions":1,"maximumPortfolioExposure":10,"minimumOpportunityScore":90,"minimumConfidence":85}',
  false
from profiles
on conflict (user_id, environment) do nothing;

do $$
begin
  if exists (
    select 1 from profiles p
    where not exists (
      select 1 from trading_environment_settings s
      where s.user_id = p.id and s.environment = 'PAPER'
    ) or not exists (
      select 1 from trading_environment_settings s
      where s.user_id = p.id and s.environment = 'LIVE'
    )
  ) then
    raise exception 'TRADE-016 repair blocked: owner environment settings are incomplete';
  end if;
end
$$;

insert into schema_migrations (version)
values ('202608140010_trade_016_final_production')
on conflict (version) do nothing;

insert into schema_migrations (version)
values ('202608160002_trade_016_migration_status_repair')
on conflict (version) do nothing;

commit;
