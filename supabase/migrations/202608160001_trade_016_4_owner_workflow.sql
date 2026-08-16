begin;

create table if not exists owner_tutorial_preferences (
  user_id uuid primary key references profiles(id) on delete cascade,
  completed boolean not null default false,
  dismissed boolean not null default false,
  auto_launch boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table paper_positions add column if not exists trade_origin text
  check (trade_origin in ('BIG_MONEY','AUTO_TRADER','MANUAL','STANDARD'));
alter table paper_positions add column if not exists broker_order_id text;
alter table paper_positions add column if not exists risk_decision_id uuid;

alter table paper_broker_fills add column if not exists trade_origin text
  check (trade_origin in ('BIG_MONEY','AUTO_TRADER','MANUAL','STANDARD'));

create table if not exists completed_paper_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  lifecycle_key text not null,
  broker_position_id text not null,
  broker_order_id text,
  symbol text not null,
  classification text not null check (classification in ('BIG','SMALL','STANDARD')),
  trade_origin text not null check (trade_origin in ('BIG_MONEY','AUTO_TRADER','MANUAL','STANDARD')),
  strategy_name text,
  direction text not null check (direction in ('LONG','SHORT')),
  quantity numeric not null,
  entry_price numeric not null,
  entry_timestamp timestamptz not null,
  exit_price numeric not null,
  exit_timestamp timestamptz not null,
  gross_pl numeric not null,
  costs numeric not null default 0,
  net_pl numeric not null,
  return_pct numeric not null,
  stop_loss numeric,
  take_profit numeric,
  entry_reason text,
  exit_reason text,
  risk_decision text,
  environment text not null default 'PAPER' check (environment = 'PAPER'),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, lifecycle_key)
);

create index if not exists completed_paper_trades_owner_exit_idx
  on completed_paper_trades (user_id, exit_timestamp desc);
create index if not exists completed_paper_trades_owner_strategy_idx
  on completed_paper_trades (user_id, strategy_name);

alter table owner_tutorial_preferences enable row level security;
alter table completed_paper_trades enable row level security;

drop policy if exists "Owners manage tutorial preferences" on owner_tutorial_preferences;
create policy "Owners manage tutorial preferences"
  on owner_tutorial_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Owners read completed PAPER trades" on completed_paper_trades;
create policy "Owners read completed PAPER trades"
  on completed_paper_trades for select
  using (auth.uid() = user_id);

insert into owner_tutorial_preferences (user_id)
select id from profiles
on conflict (user_id) do nothing;

insert into schema_migrations (version)
values ('202608160001_trade_016_4_owner_workflow')
on conflict (version) do nothing;

commit;
