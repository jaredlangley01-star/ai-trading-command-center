# OWNER SETUP — TRADE-005

1. Install the current offline IB Gateway or Trader Workstation and the official IBKR TWS API package.
2. Sign in to the IBKR **paper** account. Never use the live-account session.
3. Enable socket API connections, restrict trusted clients to `127.0.0.1`, and select paper port `4002` for IB Gateway or `7497` for TWS. Never use live ports `4001` or `7496`.
4. Run a loopback-only TWS API bridge that implements `ibkr-bridge/README.md`, using the official IBKR API, at `http://127.0.0.1:8765`.
5. Add these values to `.env.local`:
   - `IBKR_ADAPTER=TWS`
   - `IBKR_ENVIRONMENT=PAPER`
   - `IBKR_TWS_BRIDGE_URL=http://127.0.0.1:8765`
   - `IBKR_TWS_HOST=127.0.0.1`
   - `IBKR_TWS_PORT=4002` for IB Gateway, or `7497` for TWS
   - `IBKR_TWS_CLIENT_ID=41`
   - `IBKR_REQUEST_TIMEOUT_MS=10000`
6. Apply `supabase/migrations/202608130004_trade_005_market_data.sql` in the Supabase SQL Editor.
7. Restart the application and open **Paper Trading**. Confirm **PAPER CONNECTED**, then **MARKET DATA ACTIVE**, a masked account ID, and the **IBKR PAPER DATA** label.
8. Keep the IB Gateway/TWS paper session and local bridge running for unattended paper operation. Reauthenticate when the dashboard reports **AUTH REQUIRED**.
