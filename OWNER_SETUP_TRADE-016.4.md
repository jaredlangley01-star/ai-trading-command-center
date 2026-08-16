# TRADE-016.4 Owner Setup

No LIVE credentials are required. Do not configure LIVE. This release remains PAPER-only.

## 1. Run the Supabase migration

In the Supabase SQL Editor, run exactly:

`supabase/migrations/202608160001_trade_016_4_owner_workflow.sql`

Run the complete file as one script. It creates owner tutorial preferences, PAPER trade-origin metadata, and the completed PAPER trade journal. It does not delete or reset account, order, position, or trading data. Its migration-version row is inserted last inside the transaction.

## 2. Railway trading-worker configuration

Keep these server-only variables on the Railway trading-worker service:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TRADING_RUNTIME_MODE=HOSTED_PRODUCTION`
- `BROKER_ADAPTER=ALPACA_PAPER`
- `ALPACA_PAPER_API_KEY`
- `ALPACA_PAPER_API_SECRET`
- `ALPACA_PAPER_BASE_URL=https://paper-api.alpaca.markets`
- `ALPACA_API_KEY` and `ALPACA_API_SECRET` for Alpaca IEX market data
- `ALPACA_DATA_FEED=iex`

The legacy server-only `ALPACA_BROKER_API_KEY`, `ALPACA_BROKER_API_SECRET`, and `ALPACA_BROKER_BASE_URL` aliases remain accepted. Do not put broker secrets in Vercel or any client-exposed variable.

The trading-worker start command remains:

`npm run worker:start`

## 3. Railway notification-worker configuration

The notification worker is a separate Railway service. Configure:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TRADING_RUNTIME_MODE=HOSTED_PRODUCTION`
- `VAPID_SUBJECT` (normally a `mailto:` owner/support address)
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

Its start command is exactly:

`npm run worker:notifications`

Without VAPID, the worker now stays alive long enough to publish an owner-scoped `NOT CONFIGURED` heartbeat and safely marks queued pushes as undeliverable. With VAPID configured, it processes the Supabase queue and publishes `ONLINE` health. VAPID private material remains Railway-only.

## 4. Owner verification

After the migration and Railway service restarts:

1. Sign in to the authenticated application.
2. Confirm the first-use tutorial appears and can be skipped immediately.
3. Open Diagnostics and run a fresh system check.
4. Confirm the trading worker and notification worker show fresh health.
5. Open Notifications, subscribe the current device, and use **SAFE TEST NOTIFICATION**. This creates only a notification event; it cannot place a broker order.
6. Confirm LIVE continues to show **LIVE LOCKED**.

No order needs to be placed to complete deployment verification.
