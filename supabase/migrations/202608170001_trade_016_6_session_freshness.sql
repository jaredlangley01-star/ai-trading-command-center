begin;

alter table paper_market_quotes
  add column if not exists market_session text not null default 'CLOSED'
    check (market_session in ('REGULAR','PRE_MARKET','AFTER_HOURS','CLOSED')),
  add column if not exists clock_observed_at timestamptz,
  add column if not exists is_trading_day boolean,
  add column if not exists next_open timestamptz,
  add column if not exists next_close timestamptz;

insert into schema_migrations (version)
values ('202608170001_trade_016_6_session_freshness')
on conflict (version) do nothing;

commit;
