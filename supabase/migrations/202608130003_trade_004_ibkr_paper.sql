-- TRADE-004: paper-broker synchronization metadata. No credentials or session
-- material may be stored in these tables.
alter table broker_accounts add column if not exists last_sync_at timestamptz;
alter table broker_accounts add column if not exists last_error text;
create unique index if not exists broker_accounts_owner_provider_idx on broker_accounts(user_id, provider);
create index if not exists orders_owner_status_idx on orders(user_id, status);
create index if not exists trades_owner_executed_idx on trades(user_id, executed_at desc);

comment on table broker_accounts is 'Paper broker metadata only. Never store usernames, passwords, tokens, cookies, or unmasked account identifiers.';
