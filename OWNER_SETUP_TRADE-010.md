# OWNER SETUP — TRADE-010

1. In Supabase SQL Editor, apply migrations through `202608140004_trade_010_hosted_worker.sql`. Confirm the owner account exists and email registration remains disabled.
2. In Alpaca, create/retain PAPER API credentials. Do not use live credentials or the live API URL.
3. Create a private GitHub repository, commit this project, and push the production branch. Do not commit `.env*`, credentials, or tokens.
4. In Vercel, choose **Add New → Project**, authorize GitHub, import that repository, select the production branch, and keep Framework **Next.js**. Add these Production variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SITE_URL=https://YOUR_VERCEL_DOMAIN`
   - `TRADING_RUNTIME_MODE=HOSTED_PRODUCTION`
   - `BROKER_ADAPTER=ALPACA_PAPER`
   - `ALPACA_BROKER_ENVIRONMENT=PAPER`
   - `ALPACA_BROKER_API_KEY`
   - `ALPACA_BROKER_API_SECRET`
   - `ALPACA_BROKER_BASE_URL=https://paper-api.alpaca.markets`
   - `ALPACA_API_KEY`
   - `ALPACA_API_SECRET`
   - `ALPACA_DATA_FEED=iex`
   - `ALPACA_DATA_URL=https://data.alpaca.markets`
5. Deploy Vercel, copy the production HTTPS URL, and add it to Supabase Authentication → URL Configuration as the Site URL and an allowed redirect URL (`https://YOUR_DOMAIN/**`).
6. In Railway, choose **New Project → Deploy from GitHub repo**, authorize GitHub, select the same repository, and create one service. Railway reads `railway.json`; confirm Start Command is `npm run worker:start`.
7. Add these Railway variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `TRADING_RUNTIME_MODE=HOSTED_PRODUCTION`
   - `BROKER_ADAPTER=ALPACA_PAPER`
   - `ALPACA_BROKER_ENVIRONMENT=PAPER`
   - `ALPACA_BROKER_API_KEY`
   - `ALPACA_BROKER_API_SECRET`
   - `ALPACA_BROKER_BASE_URL=https://paper-api.alpaca.markets`
   - `ALPACA_API_KEY`
   - `ALPACA_API_SECRET`
   - `ALPACA_DATA_FEED=iex`
   - `ALPACA_DATA_URL=https://data.alpaca.markets`
   - `WORKER_ID=railway-trading-engine`
   - `WORKER_INTERVAL_MS=30000`
   - `WORKER_SCAN_SYMBOLS=AAPL,MSFT,NVDA,SPY`
   - `WORKER_VERSION=TRADE-010`
   - `AUTO_TRADER_INITIAL_STATE=PAUSED`
8. Deploy Railway. Wait for `worker_cycle_complete` in logs, then sign in to Vercel and confirm Trading Engine shows **ONLINE**, Database **CONNECTED**, Broker **ALPACA / PAPER**, Runtime **HOSTED PRODUCTION**, and LIVE **LOCKED**.
9. Confirm Auto Trader is **PAUSED**. Enable it only through the authenticated dashboard after reviewing risk settings. Do not submit a deployment test order.
