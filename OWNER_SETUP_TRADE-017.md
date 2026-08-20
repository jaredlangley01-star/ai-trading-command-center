# OWNER SETUP — TRADE-017

1. Apply `supabase/migrations/202608200001_trade_017_intraday_trader.sql` after the TRADE-016.7 migration.

2. In the existing Vercel web service, retain:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SITE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - Existing Alpaca market-data variables

3. Optional Vercel Trader AI variables:
   - `AI_API_URL=https://api.openai.com/v1`
   - `AI_MODEL=`
   - `AI_API_KEY=`

   Leave `AI_MODEL` and `AI_API_KEY` empty to use deterministic Trader responses. Trading remains operational without AI.

4. In the existing Railway Trading Worker, retain all current variables and set:
   - `WORKER_VERSION=TRADE-017`

   Keep `/railway.json` and `npm run worker:start`.

5. In the existing Railway Notification Worker, retain its current Supabase and VAPID variables. Keep `/railway.notifications.json` and `npm run worker:notifications`.

6. Create a separate Railway service from the same repository for Trader. Select `/railway.trader.json` as Config-as-Code and set only:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `TRADING_RUNTIME_MODE=HOSTED_PRODUCTION`
   - `TRADER_WORKER_ID=railway-trader-worker`
   - `TRADER_WORKER_INTERVAL_MS=300000`
   - `TRADER_PROACTIVE_COOLDOWN_MS=3600000`

   Do not place Alpaca, broker, VAPID, or AI credentials in the Trader Worker.

7. Deploy the reviewed Vercel, Trading Worker, Notification Worker, and Trader Worker revisions.

8. Open Diagnostics and verify the TRADE-017 migration is present. Open Auto Trader and review the entry start, last-entry, force-exit, maximum-hold, and minimum-exit-score settings before enabling it.

9. Confirm all open Auto Trader and Big Money PAPER positions show stop, target, and `PROTECTED`. Investigate every `UNPROTECTED` warning immediately.

10. Keep LIVE locked. Do not submit a test order automatically during setup.
