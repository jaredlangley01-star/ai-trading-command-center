# REAL CHANGE REVIEW — TRADE-009

## Outcome

The Big Money workspace now provides an owner-scoped PAPER research and recommendation workflow using Alpaca IEX market data, the existing Strategy Engine, portfolio exposure, and production risk settings. Recommendations never execute without a separate explicit owner approval.

## Research and recommendation workflow

- Market Data → Strategy Engine → Research Engine → Risk Manager → Recommended Trade → Owner Approval.
- Trend, momentum, breakout, mean-reversion, volatility, historical candles, volume, exposure, open positions, and risk limits flow through existing engines.
- Live news, fundamentals, and external AI research are explicitly marked unavailable until providers exist.
- Strategy and research scores are model scores, never probabilities of profit.
- Conservative, Recommended, and Aggressive risk profiles include capital, stop, maximum loss, target, and risk/reward.

## Approval safety

- Approval requires a second explicit `PAPER TRADE ONLY` confirmation.
- Pending status, expiry, live quote freshness, material price movement, and owner modifications are revalidated.
- Production Risk Manager and TradePermissionService run immediately before the IBKR PAPER broker.
- Emergency Stop, risk rejection, stale data, expiry, changed prices, missing IBKR, and any LIVE request fail closed.
- Alpaca remains market-data-only and has no order surface.

## Persistence

- Added owner-scoped research runs, recommendation versions, lifecycle state, selected risk profile, modifications, approval/rejection metadata, and internal recommendation events.
- Row Level Security uses `auth.uid() = user_id` policies.
- No external notification provider was connected.

## Verification

- Big Money research, approval, expiry, modification, RLS, and execution-routing tests: passed.
- Full application tests: 68 passed.
- IBKR bridge tests: 11 passed.
- TypeScript: passed.
- ESLint: passed.
- Production build: passed.
- Prettier: passed.
- `git diff --check`: passed.
