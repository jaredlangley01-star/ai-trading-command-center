create table if not exists market_news (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  provider_id text not null, headline text not null, summary text not null, source text not null, author text,
  published_at timestamptz not null, symbols jsonb not null default '[]', url text not null, retrieved_at timestamptz not null,
  analysis jsonb not null default '{}', unique(user_id, provider_id)
);
create table if not exists company_fundamentals (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  symbol text not null, cik text not null, metric_name text not null, value numeric not null, unit text not null,
  period_end date, filed_at date, form text, provenance text not null check(provenance in ('REPORTED','DERIVED')),
  retrieved_at timestamptz not null, unique(user_id,symbol,metric_name,period_end,form)
);
create table if not exists sec_filings (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  symbol text not null, cik text not null, form text not null, filing_date date not null, accession text not null,
  company text not null, source_url text not null, retrieved_at timestamptz not null, unique(user_id,accession)
);
create table if not exists corporate_actions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  provider_id text not null, symbol text not null, action_type text not null, effective_date date,
  details jsonb not null default '{}', retrieved_at timestamptz not null, availability_notice text not null default 'Provider availability may be delayed.',
  unique(user_id,provider_id)
);
create table if not exists market_context_snapshots (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  context_key text not null, regime text not null, score numeric not null, confidence numeric not null,
  evidence jsonb not null default '{}', as_of timestamptz not null, unique(user_id,context_key,as_of)
);
create table if not exists intelligence_research_jobs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  symbol text not null, job_key text not null, status text not null check(status in ('QUEUED','RUNNING','COMPLETED','FAILED')),
  started_at timestamptz, completed_at timestamptz, error text, created_at timestamptz not null default now(),
  unique(user_id,job_key)
);
create table if not exists intelligence_snapshots (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  job_id uuid references intelligence_research_jobs(id) on delete set null, symbol text not null, direction text not null check(direction in ('BUY','SELL','NO_TRADE')),
  current_price numeric not null, opportunity_score numeric not null, confidence numeric not null,
  technical_score numeric not null, fundamental_score numeric not null, catalyst_score numeric not null,
  market_context_score numeric not null, historical_score numeric not null, risk_score numeric not null,
  weights jsonb not null, source_facts jsonb not null, deterministic_analysis jsonb not null,
  ai_status text not null, ai_analysis jsonb, freshness jsonb not null, source_references jsonb not null default '[]',
  generated_at timestamptz not null, unique(user_id,symbol,generated_at)
);
create index if not exists intelligence_rank_idx on intelligence_snapshots(user_id,opportunity_score desc,generated_at desc);

alter table market_news enable row level security; alter table company_fundamentals enable row level security;
alter table sec_filings enable row level security; alter table corporate_actions enable row level security;
alter table market_context_snapshots enable row level security; alter table intelligence_research_jobs enable row level security;
alter table intelligence_snapshots enable row level security;
create policy "Owners read own market news" on market_news for select using(auth.uid()=user_id);
create policy "Owners read own fundamentals" on company_fundamentals for select using(auth.uid()=user_id);
create policy "Owners read own SEC filings" on sec_filings for select using(auth.uid()=user_id);
create policy "Owners read own corporate actions" on corporate_actions for select using(auth.uid()=user_id);
create policy "Owners read own market context" on market_context_snapshots for select using(auth.uid()=user_id);
create policy "Owners manage own research jobs" on intelligence_research_jobs for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy "Owners read own intelligence" on intelligence_snapshots for select using(auth.uid()=user_id);
