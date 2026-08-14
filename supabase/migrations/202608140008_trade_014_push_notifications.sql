create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null, p256dh text not null, auth text not null, user_agent text, device_name text,
  active boolean not null default true, created_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  unique(user_id, endpoint)
);
create table if not exists notification_preferences (
  user_id uuid primary key references profiles(id) on delete cascade, preferences jsonb not null default '{}'::jsonb,
  critical_disable_acknowledged_at timestamptz, updated_at timestamptz not null default now()
);
create table if not exists notification_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  event_type text not null, category text not null, severity text not null check (severity in ('INFO','WARNING','CRITICAL')),
  title text not null, body text not null, payload jsonb not null default '{}'::jsonb, deep_link text not null default '/?section=Notifications',
  dedupe_key text not null, status text not null default 'QUEUED' check (status in ('QUEUED','PROCESSING','DELIVERED','PARTIAL','SUPPRESSED','FAILED')),
  suppression_reason text, available_at timestamptz not null default now(), created_at timestamptz not null default now(), processed_at timestamptz,
  unique(user_id, dedupe_key)
);
create table if not exists notification_delivery_attempts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  event_id uuid not null references notification_events(id) on delete cascade, subscription_id uuid references push_subscriptions(id) on delete set null,
  status text not null, provider_status integer, error_code text, attempted_at timestamptz not null default now()
);
create table if not exists notification_read_state (
  user_id uuid not null references profiles(id) on delete cascade, event_id uuid not null references notification_events(id) on delete cascade,
  read_at timestamptz not null default now(), primary key(user_id,event_id)
);
create table if not exists notification_cooldowns (
  user_id uuid not null references profiles(id) on delete cascade, cooldown_key text not null,
  last_delivered_at timestamptz not null, event_id uuid references notification_events(id) on delete set null,
  primary key(user_id,cooldown_key)
);
alter table push_subscriptions enable row level security; alter table notification_preferences enable row level security;
alter table notification_events enable row level security; alter table notification_delivery_attempts enable row level security;
alter table notification_read_state enable row level security; alter table notification_cooldowns enable row level security;
create policy "Owners manage own push subscriptions" on push_subscriptions for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "Owners manage own notification preferences" on notification_preferences for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "Owners read own notification events" on notification_events for select using (auth.uid()=user_id);
create policy "Owners create own notification events" on notification_events for insert with check (auth.uid()=user_id);
create policy "Owners read own delivery attempts" on notification_delivery_attempts for select using (auth.uid()=user_id);
create policy "Owners manage own read state" on notification_read_state for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "Owners read own cooldown state" on notification_cooldowns for select using (auth.uid()=user_id);
comment on table push_subscriptions is 'Public Web Push subscription material only; VAPID private keys remain in Railway environment variables.';
