-- TRADE-009: owner-approved, PAPER-only research recommendations.
create table if not exists research_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  symbol text not null, market_data_source text not null, quote_timestamp timestamptz not null,
  unavailable_dimensions jsonb not null default '[]'::jsonb, inputs jsonb not null, output jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists recommendation_versions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  recommendation_id uuid not null references recommendations(id) on delete cascade, version integer not null,
  values jsonb not null, change_reason text not null, created_at timestamptz not null default now(),
  unique(recommendation_id, version)
);
create table if not exists recommendation_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  recommendation_id uuid not null references recommendations(id) on delete cascade,
  event_type text not null check (event_type in ('NEW_RECOMMENDATION','EXPIRING_SOON','EXPIRED','APPROVAL_REQUIRED','BLOCKED_MARKET_CHANGE')),
  payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create unique index if not exists recommendation_events_once_idx on recommendation_events(recommendation_id,event_type);
alter table recommendations add column if not exists research_run_id uuid references research_runs(id);
alter table recommendations add column if not exists research_score numeric not null default 0;
alter table recommendations add column if not exists current_price numeric;
alter table recommendations add column if not exists maximum_planned_loss numeric;
alter table recommendations add column if not exists risk_reward numeric;
alter table recommendations add column if not exists market_condition text;
alter table recommendations add column if not exists data_source text;
alter table recommendations add column if not exists quote_timestamp timestamptz;
alter table recommendations add column if not exists expires_at timestamptz;
alter table recommendations add column if not exists selected_risk_profile text;
alter table recommendations add column if not exists risk_profiles jsonb not null default '[]'::jsonb;
alter table recommendations add column if not exists owner_modifications jsonb not null default '{}'::jsonb;
alter table recommendations add column if not exists approval_timestamp timestamptz;
alter table recommendations add column if not exists rejection_reason text;
alter table recommendations add column if not exists version integer not null default 1;
alter table recommendations add column if not exists updated_at timestamptz not null default now();
create index if not exists recommendations_owner_status_time_idx on recommendations(user_id,status,created_at desc);
alter table research_runs enable row level security;
alter table recommendation_versions enable row level security;
alter table recommendation_events enable row level security;
create policy "Owners manage research runs" on research_runs for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "Owners manage recommendation versions" on recommendation_versions for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "Owners manage recommendation events" on recommendation_events for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
comment on table recommendation_events is 'Internal-only Big Money lifecycle events; no external notification provider.';
