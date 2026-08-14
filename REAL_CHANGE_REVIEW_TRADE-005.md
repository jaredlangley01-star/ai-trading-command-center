# REAL CHANGE REVIEW — TRADE-005

## Mission summary

Added a paper-only IB Gateway/TWS adapter and Market Data Engine while retaining the existing Client Portal adapter as an isolated alternative. No IBKR session or credentials were available, so no external broker connection or order was attempted.

## Architecture

- `createPaperBroker` selects a generic `BrokerService`; core code never imports an IBKR client.
- The automated path is Market Data Engine → Strategy Engine → Risk Manager → TradePermissionService → generic paper broker.
- The TWS adapter also implements generic market-data methods for bid, ask, last price, and historical candles.
- A documented loopback bridge contract isolates the official non-TypeScript TWS socket client from the web application.
- Client Portal remains selectable with `IBKR_ADAPTER=CLIENT_PORTAL`.

## Paper safety

- `IBKR_ENVIRONMENT` must be explicitly `PAPER`.
- Only paper socket ports `4002` and `7497` are accepted; live ports and LIVE order modes throw `LIVE_TRADING_LOCKED`.
- Explicit paper confirmation, Risk Manager refresh, and TradePermissionService approval precede automated broker submission.
- Emergency Stop blocks permission and no strategy can directly access IBKR.
- Broker and market-data failures return safe states and cannot disable or bypass risk controls.
- No usernames, passwords, session cookies, tokens, account numbers, or service-role credentials are present client-side.

## Connectivity and data

- Supports disconnected, connecting, paper-connected, market-data-active, authentication-required, and error states.
- Prepares normalized reads for account summary, cash, positions, orders, executions, quotes, and historical candles.
- Connected values use the `IBKR PAPER DATA` source; unavailable connections retain the `DEMO DATA` fallback.
- Market-data failures are contained as empty error snapshots rather than dashboard crashes.

## Reconnect and persistence

- Every paper order requires a stable client order ID.
- An owner-scoped unique database index returns the existing paper order before any retry can reach the broker.
- Added owner-scoped RLS for market-data synchronization status and timestamps.
- Broker secrets are not stored in Supabase.

## Key files

- `src/services/broker/ib-gateway-broker-service.ts`
- `src/services/broker/factory.ts`
- `src/services/market-data-engine.ts`
- `src/services/broker/dashboard.ts`
- `app/api/broker/orders/route.ts`
- `app/api/broker/status/route.ts`
- `components/trading-command-center.tsx`
- `ibkr-bridge/README.md`
- `supabase/migrations/202608130004_trade_005_market_data.sql`
- `tests/market-data-engine.test.mjs`

## Verification results

- Production build: passed.
- TypeScript: passed.
- ESLint: passed.
- Tests: passed (27/27).
- Prettier: passed.
- `git diff --check`: passed.

## Safety confirmation

**LIVE remains hard locked at configuration, orchestration, adapter, and UI layers.**

**No live execution route, real-money capability, or client-side broker secret exists.**
