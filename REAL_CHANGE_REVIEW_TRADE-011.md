# REAL CHANGE REVIEW — TRADE-011

## Outcome

The hosted architecture now synchronizes the Alpaca PAPER account, positions, open orders, fills, realized/unrealized P/L, exposure, and intraday portfolio history into owner-scoped Supabase records. The Vercel dashboard polls those records every five seconds and replaces demo portfolio values whenever a hosted PAPER snapshot is available.

## Hosted position management

- Railway retrieves Alpaca PAPER account, position, order, fill, and portfolio-history data each cycle.
- Open positions retain stop-loss, take-profit, strategy, and opened-at metadata across synchronizations.
- LONG and SHORT stop/target conditions are evaluated continuously.
- A protective exit may only reduce the synchronized open quantity, is always a confirmed PAPER market order, and uses the opposite side.
- Auto Trader pause, daily locks, profit targets, and Emergency Stop block new entries but do not stop position synchronization or safe protective exits.
- LIVE mode and every non-paper Alpaca endpoint remain rejected.

## Durability

- One exit claim is permitted per owner/broker position and is written before the broker call.
- Broker executions are unique by owner and Alpaca execution ID.
- Portfolio P/L samples are unique by owner and minute.
- Worker restarts, overlapping cycles, and network retries therefore cannot create duplicate exits, fills, or history samples.

## Dashboard

Authenticated `/api/portfolio` reads only records allowed by owner RLS. The dashboard shows ALPACA PAPER DATA, equity, cash, buying power, realized P/L, unrealized P/L, exposure, position count, synchronized positions, and recent fills. Transient API failures preserve the last safe snapshot rather than reverting live positions to invented values.

## Migration and deployment

Apply `supabase/migrations/202608140005_trade_011_hosted_portfolio.sql` before restarting the Railway worker. No deployment or LIVE enablement was performed.
