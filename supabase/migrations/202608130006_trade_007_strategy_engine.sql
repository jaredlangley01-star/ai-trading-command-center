-- TRADE-007: owner-scoped analytical strategy signals and opportunities.
create unique index if not exists strategies_owner_name_idx
  on strategies(user_id, name);

create table if not exists strategy_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  strategy_name text not null,
  symbol text not null,
  direction text not null check (direction in ('BUY','SELL','NO_TRADE')),
  score integer not null check (score between 0 and 100),
  entry_suggestion numeric,
  stop_loss_suggestion numeric,
  take_profit_suggestion numeric,
  risk_reward numeric,
  reasoning text not null,
  data_source text not null,
  evaluated_at timestamptz not null default now()
);

create table if not exists strategy_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  symbol text not null,
  final_recommendation text not null check (final_recommendation in ('BUY','SELL','NO_TRADE')),
  combined_score integer not null check (combined_score between 0 and 100),
  supporting_strategies jsonb not null default '[]'::jsonb,
  conflicting_strategies jsonb not null default '[]'::jsonb,
  market_analysis jsonb,
  data_source text not null,
  evaluated_at timestamptz not null default now()
);

create table if not exists strategy_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  symbol text not null,
  strategy_count integer not null,
  result jsonb not null,
  evaluated_at timestamptz not null default now()
);

create index if not exists strategy_signals_owner_time_idx
  on strategy_signals(user_id, evaluated_at desc);
create index if not exists strategy_opportunities_owner_score_idx
  on strategy_opportunities(user_id, combined_score desc, evaluated_at desc);
create index if not exists strategy_evaluations_owner_time_idx
  on strategy_evaluations(user_id, evaluated_at desc);

alter table strategy_signals enable row level security;
alter table strategy_opportunities enable row level security;
alter table strategy_evaluations enable row level security;
create policy "Owners manage strategy signals" on strategy_signals for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Owners manage strategy opportunities" on strategy_opportunities for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Owners manage strategy evaluations" on strategy_evaluations for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table strategy_signals is 'Analytical PAPER signals only; never broker instructions.';
