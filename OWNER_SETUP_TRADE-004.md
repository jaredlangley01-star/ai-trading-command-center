# OWNER SETUP — TRADE-004

1. Wait until the IBKR account is fully approved and confirm it is an IBKR Pro account with Paper Trading enabled.
2. In IBKR Client Portal, open **Settings → Paper Trading Account** and note the separate paper username. Do not place it in this project or in Supabase.
3. Install Java 8 update 192 or newer and download the official IBKR Client Portal Gateway.
4. Start the Gateway on the same computer as Trading Command Center.
5. Open `https://localhost:5000`, sign in with the paper username, complete two-factor authentication, and verify the Gateway reports a successful login.
6. If using the Gateway’s self-signed certificate, install/trust a locally signed certificate. Keep `IBKR_ALLOW_SELF_SIGNED_LOCAL_CERT=false`.
7. In `.env.local`, set:
   - `IBKR_ENVIRONMENT=PAPER`
   - `IBKR_GATEWAY_URL=https://localhost:5000/v1/api`
   - `IBKR_REQUEST_TIMEOUT_MS=10000`
8. Run `supabase/migrations/202608130003_trade_004_ibkr_paper.sql` in the Supabase SQL Editor.
9. Restart Trading Command Center, sign in, open **Paper Trading**, and confirm the status is **PAPER CONNECTED** and the account ID is masked.
10. Reauthenticate the Client Portal Gateway after midnight each day or whenever the session expires.
