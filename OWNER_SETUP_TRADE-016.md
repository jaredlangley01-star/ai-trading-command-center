# OWNER SETUP — TRADE-016

1. In Supabase SQL Editor, apply `supabase/migrations/202608140010_trade_016_final_production.sql` after all earlier migrations.
2. In Railway Trading Worker, retain all TRADE-015 variables and add:
   - `ALPACA_PAPER_API_KEY`
   - `ALPACA_PAPER_API_SECRET`
   - `ALPACA_PAPER_BASE_URL=https://paper-api.alpaca.markets`
   - `LIVE_TRADING_ENABLED=false`
   - `WORKER_VERSION=TRADE-016`
3. In Railway Notification Worker, retain Supabase/VAPID variables and set `WORKER_VERSION=TRADE-016` and optionally `NOTIFICATION_WORKER_ID=railway-notification-worker`.
4. In Vercel, retain the existing public Supabase/site/VAPID variables. Do not add Alpaca secrets or service-role credentials as `NEXT_PUBLIC_*`.
5. Optional LIVE preparation only: add `ALPACA_LIVE_API_KEY`, `ALPACA_LIVE_API_SECRET`, and `ALPACA_LIVE_BASE_URL=https://api.alpaca.markets` to Railway. Keep `LIVE_TRADING_ENABLED=false`.
6. Push the reviewed branch, allow Vercel and both Railway services to redeploy, then open **Diagnostics** and select **RUN SYSTEM CHECK**.
7. Confirm: WEB online, both workers online, Supabase healthy, Alpaca IEX configured, PAPER broker healthy, Risk Manager/Position Protection healthy, schema through TRADE-016, PAPER READY, and LIVE READY — LOCKED.
8. Complete `PAPER_VALIDATION_GUIDE.md`. Do not enable LIVE based only on successful PAPER results.
