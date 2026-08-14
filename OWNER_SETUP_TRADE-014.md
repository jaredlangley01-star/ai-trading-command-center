# OWNER SETUP — TRADE-014

1. Apply `supabase/migrations/202608140008_trade_014_push_notifications.sql` in Supabase.
2. Generate one VAPID key pair. Keep the private key secret.
3. Add to Vercel: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` with the public VAPID key. Retain the existing Supabase public variables.
4. Add to the Railway notification-worker service: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TRADING_RUNTIME_MODE=HOSTED_PRODUCTION`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:<owner-contact>`, `NOTIFICATION_WORKER_INTERVAL_MS=30000`, and `TRADING_ENGINE_OFFLINE_AFTER_MS=120000`.
5. Configure that Railway service’s start command as `npm run worker:notifications`. Keep the existing trading-worker service and start command unchanged.
6. After a future authorized deployment, install the hosted site to the phone home screen, sign in, open Settings, select **Enable & Subscribe**, and send the safe test notification.
