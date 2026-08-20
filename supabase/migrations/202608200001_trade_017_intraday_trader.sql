begin;

alter table auto_trader_config add column if not exists entry_start time not null default '09:35';
alter table auto_trader_config add column if not exists last_entry_time time not null default '15:15';
alter table auto_trader_config add column if not exists force_exit_time time not null default '15:50';
alter table auto_trader_config add column if not exists maximum_hold_minutes integer default 120 check (maximum_hold_minutes is null or maximum_hold_minutes between 5 and 1440);
alter table auto_trader_config add column if not exists minimum_exit_score integer not null default 45 check (minimum_exit_score between 0 and 100);
alter table auto_trader_config add column if not exists strategy_health_minimum_sample integer not null default 20 check (strategy_health_minimum_sample between 5 and 500);

alter table paper_positions add column if not exists planned_stop numeric;
alter table paper_positions add column if not exists planned_target numeric;
alter table paper_positions add column if not exists protection_status text not null default 'UNPROTECTED' check (protection_status in ('PROTECTED','UNPROTECTED'));
alter table paper_positions add column if not exists protection_type text check (protection_type in ('BROKER_NATIVE','WORKER_MONITORED','HYBRID'));
alter table paper_positions add column if not exists protection_verified_at timestamptz;
alter table paper_positions add column if not exists maximum_hold_minutes integer;
alter table paper_positions add column if not exists force_exit_at timestamptz;

alter table paper_position_exit_claims drop constraint if exists paper_position_exit_claims_reason_check;
alter table paper_position_exit_claims add constraint paper_position_exit_claims_reason_check check (reason in ('STOP_LOSS','TAKE_PROFIT','SIGNAL_WEAKENED','SIGNAL_REVERSED','STRATEGY_INVALIDATED','RISK_EXIT','MAX_HOLD_TIME','END_OF_SESSION','MANUAL','EMERGENCY_EXIT'));

create table if not exists trader_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null check (role in ('OWNER','TRADER')),
  content text not null,
  context_snapshot jsonb not null default '{}',
  actions jsonb not null default '[]',
  proactive boolean not null default false,
  dedupe_key text,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create table if not exists trader_strategy_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  specification jsonb not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','BACKTESTING','REVIEW','APPROVED','ACTIVE','REJECTED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists trader_worker_heartbeats (
  user_id uuid primary key references profiles(id) on delete cascade,
  worker_id text not null,
  status text not null,
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);

create index if not exists trader_messages_owner_created_idx on trader_messages(user_id, created_at desc);
alter table trader_messages enable row level security;
alter table trader_strategy_proposals enable row level security;
alter table trader_worker_heartbeats enable row level security;

create policy "Owners read Trader messages" on trader_messages for select using (auth.uid() = user_id);
create policy "Owners insert Trader messages" on trader_messages for insert with check (auth.uid() = user_id and role = 'OWNER' and proactive = false);
create policy "Owners manage Trader proposals" on trader_strategy_proposals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Owners read Trader worker heartbeat" on trader_worker_heartbeats for select using (auth.uid() = user_id);

insert into schema_migrations(version) values ('202608200001_trade_017_intraday_trader') on conflict(version) do nothing;
commit;
