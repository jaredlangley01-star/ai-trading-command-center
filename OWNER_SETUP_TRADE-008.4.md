# OWNER SETUP — TRADE-008.4

1. Sign in to Alpaca and create API keys for your personal account.
2. Copy `.env.example` to `.env.local` if `.env.local` does not already exist.
3. Set `ALPACA_API_KEY` to the Alpaca API key ID.
4. Set `ALPACA_API_SECRET` to the Alpaca API secret.
5. Keep `ALPACA_DATA_FEED=iex`.
6. Keep `ALPACA_DATA_URL=https://data.alpaca.markets`.
7. Optionally set `MARKET_DATA_MAX_AGE_MS`; the default is 30000 milliseconds.
8. Restart the local application after changing environment variables.
9. Sign in and verify Market Data shows `ALPACA — IEX / CONNECTED` while Broker independently shows Interactive Brokers PAPER status.

Do not prefix either Alpaca credential with `NEXT_PUBLIC_`. Do not enter Alpaca credentials in the browser, Supabase, or source code.
