begin;

alter table automated_decisions
  add column if not exists market_data_audit jsonb not null default '{}'::jsonb;
alter table automated_decisions
  add column if not exists test_mode_context jsonb not null default '{}'::jsonb;

alter table paper_broker_fills
  add column if not exists paper_test_mode boolean not null default false;
alter table paper_broker_fills
  add column if not exists test_slot integer;

insert into schema_migrations(version)
values ('202608210001_trade_018_3_execution_recovery')
on conflict(version) do nothing;

commit;
