# OWNER SETUP — TRADE-016.7

1. Apply `supabase/migrations/202608170002_trade_016_7_order_monitor.sql` after the TRADE-016.6 migration.
2. Deploy the reviewed commit to Vercel and both existing Railway services.
3. Keep the Trading Worker configuration at `/railway.json` with `npm run worker:start`.
4. Keep the Notification Worker configuration at `/railway.notifications.json` with `npm run worker:notifications`.
5. Do not add or move credentials. No new environment variables are required.
6. After one successful trading-worker cycle, open **Diagnostics** and confirm **Execution Queue** is HEALTHY.
7. Open **Orders** and confirm existing persisted PAPER orders appear. An accepted LIMIT order may correctly remain `WAITING FOR LIMIT PRICE`.
8. Keep LIVE locked. Do not automatically place a test order during deployment.
