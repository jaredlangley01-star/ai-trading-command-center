# OWNER SETUP — TRADE-009.5

## Vercel

1. Set `TRADING_RUNTIME_MODE=HOSTED_PRODUCTION`.
2. Set `BROKER_ADAPTER=ALPACA_PAPER`.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the Supabase project.
4. Set `SUPABASE_SERVICE_ROLE_KEY` only if the existing server deployment requires it; never expose it to the browser.
5. Set `ALPACA_API_KEY`, `ALPACA_API_SECRET`, `ALPACA_DATA_FEED=iex`, and `ALPACA_DATA_URL=https://data.alpaca.markets` for market data.
6. Set `ALPACA_BROKER_ENVIRONMENT=PAPER`.
7. Set `ALPACA_BROKER_API_KEY` and `ALPACA_BROKER_API_SECRET` to Alpaca PAPER credentials.
8. Set `ALPACA_BROKER_BASE_URL=https://paper-api.alpaca.markets`.

## Railway Trading Engine

1. Set `TRADING_RUNTIME_MODE=HOSTED_PRODUCTION`.
2. Set `BROKER_ADAPTER=ALPACA_PAPER`.
3. Add the same Supabase, Alpaca market-data, and Alpaca PAPER broker variables listed above.
4. Add the hosted Vercel application URL to the engine's allowed-origin configuration when that engine service is introduced.

Do not set any IBKR, localhost, TWS, Gateway, Python bridge, or local scheduling variables in Vercel or Railway. Do not use Alpaca LIVE credentials or `https://api.alpaca.markets`.
