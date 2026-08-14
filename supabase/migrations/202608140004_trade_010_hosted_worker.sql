create table if not exists trading_worker_heartbeats (
  user_id uuid not null references profiles(id) on delete cascade,
  worker_id text not null,
  status text not null check (status in ('ONLINE','OFFLINE','ERROR')),
  runtime text not null check (runtime = 'HOSTED_PRODUCTION'),
  version text not null,
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (user_id, worker_id)
);
create table if not exists trading_worker_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  worker_id text not null,
  task_type text not null,
  idempotency_key text not null unique,
  status text not null check (status in ('STARTED','COMPLETED','FAILED','SKIPPED')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table trading_worker_heartbeats enable row level security;
alter table trading_worker_runs enable row level security;
create policy "Owners read own worker heartbeat" on trading_worker_heartbeats for select using (auth.uid() = user_id);
create policy "Owners read own worker runs" on trading_worker_runs for select using (auth.uid() = user_id);
update system_state set auto_trader_status = 'PAUSED', updated_at = now();
update auto_trader_config set enabled = false, updated_at = now();
