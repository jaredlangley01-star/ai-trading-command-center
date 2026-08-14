# REAL CHANGE REVIEW — TRADE-008.4

## Outcome

Alpaca IEX is now the primary server-side equities market-data provider. It supplies normalized latest quotes, trades, multi-symbol snapshots, historical OHLCV candles, timestamps, and health metadata. IBKR remains the independent PAPER account and execution provider.

## Live-data architecture

- A centralized server route requests multiple symbols through one cached provider.
- The authenticated dashboard refreshes that centralized snapshot every five seconds without reloading the page.
- The free/basic feed is always identified as `ALPACA — IEX`, never as consolidated SIP data.
- Explicit fallbacks are `IBKR PAPER DATA`, `SIMULATED/DEMO DATA`, and `MARKET DATA DISCONNECTED`.
- Strategies and opportunities consume the existing generic `MarketDataService`; they never import Alpaca or IBKR adapters directly.

## Price safety

- New PAPER orders obtain a current quote through the primary market-data factory.
- Missing and stale quotes fail closed before risk approval or broker submission.
- Quote provider, feed, timestamp, and age are attached to the PAPER-order audit event.
- Auto Trader decisions retain the market-data source and timestamp used by the opportunity evaluation.
- Market-data failure blocks new automated entries but does not alter or close existing positions.

## Security and execution safety

- Alpaca credentials are read only from server environment variables.
- No client component receives Alpaca credentials.
- `AlpacaMarketDataService` has no order methods or trading endpoint.
- Auto Trader execution remains Strategy → Opportunity → Risk Manager → TradePermissionService → IBKR PAPER broker.
- LIVE remains hard locked. Existing IBKR order execution code was not replaced.

## Verification

- Alpaca normalization and safety tests: passed.
- Full application tests: 61 passed.
- Existing IBKR bridge tests: 11 passed.
- TypeScript: passed.
- ESLint: passed.
- Production build: passed.
- Prettier: passed.
- `git diff --check`: passed.
