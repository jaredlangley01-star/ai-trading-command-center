# OWNER SETUP — TRADE-015

1. Apply `supabase/migrations/202608140009_trade_015_autonomous_hardening.sql` in Supabase.
2. Retain the existing Railway trading-worker PAPER variables and set `WORKER_VERSION=TRADE-015`. Confirm `TRADING_RUNTIME_MODE=HOSTED_PRODUCTION`, `BROKER_ADAPTER=ALPACA_PAPER`, `ALPACA_BROKER_ENVIRONMENT=PAPER`, and `ALPACA_BROKER_BASE_URL=https://paper-api.alpaca.markets`.
3. In Vercel, optionally set `FX_RATE_BASE_URL=https://api.frankfurter.dev` and `NEXT_PUBLIC_DASHBOARD_REFRESH_INTERVAL_MS=30000`. No FX credential is required.
4. After a future authorized deployment, open Auto Trader, review every new limit, allowed symbol, strategy, direction, session, and cooldown setting, then save. Auto Trader remains paused until the owner explicitly enables it.
5. Confirm the Dashboard chart reports Alpaca IEX, the selected currency is labelled display-only, LIVE shows locked, and Railway reconciliation/heartbeat records update before enabling autonomous PAPER entries.
