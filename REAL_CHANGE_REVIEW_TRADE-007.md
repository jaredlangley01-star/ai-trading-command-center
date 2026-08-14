# REAL CHANGE REVIEW — TRADE-007

## Mission summary

Added the first analytical PAPER Strategy Engine with Trend Following, Momentum, Breakout, and Mean Reversion modules. The engine consumes the generic Market Data Engine, produces structured signals and combined opportunities, and has no broker or order-submission capability.

## Strategy modules

Every module returns:

- Symbol and `BUY`, `SELL`, or `NO_TRADE`
- Strategy name and normalized 0–100 signal-strength score
- Suggested entry, stop loss, take profit, and risk/reward
- Plain-language reasoning and evaluation timestamp

The modules use current price, bid/ask, historical candles, volume when present, average true range, realized volatility, moving-average trend, price momentum, range breakouts, and mean displacement. Invalid or insufficient data always produces `NO_TRADE` with no suggested levels.

## Combined Opportunity Engine

- Evaluates all active modules against one immutable market snapshot.
- Separates supporting and conflicting strategies.
- Uses directional score weight and a conservative conflict threshold.
- Balanced or insufficiently strong conflicts resolve to `NO_TRADE`.
- Reports combined score, final recommendation, source, volatility, trend, and momentum.
- Scores are explicitly described as normalized signal strength—not probability of profit.

## Architecture and safety

- Flow remains Market Data → Strategy Engine → Risk Manager → TradePermissionService → generic PAPER Broker.
- Strategy modules import no broker service, IBKR adapter, order route, or execution method.
- The Strategy API only performs analysis and persistence; it cannot submit an order.
- Disconnected market data uses an explicitly labeled deterministic `DEMO DATA` provider.
- IBKR market data remains labeled `IBKR PAPER DATA` when available.
- Emergency Stop, Production Risk Manager, paper ports, and `LIVE_TRADING_LOCKED` remain unchanged.

## Dashboard

- Added a Strategy Engine workspace with active modules, monitored assets, recent signal count, per-strategy scores and reasoning, and a clearly marked performance placeholder.
- Added ranked Opportunities with combined recommendation, supporting/conflicting strategies, score, timestamp, and data source.
- Added on-demand analysis for AAPL, NVDA, MSFT, and AMZN.
- Preserved the existing premium desktop and mobile visual system.

## Persistence and RLS

- Strategy configuration persists in the existing `strategies` table.
- Added owner-scoped `strategy_signals`, `strategy_opportunities`, and `strategy_evaluations` tables.
- Every evaluation stores the structured signals, combined opportunity, market-analysis summary, and source.
- All new tables have Row Level Security policies based on `auth.uid()`.

## Main files

- `src/services/strategies/`
- `src/services/market-data/demo-market-data-service.ts`
- `src/services/market-data/factory.ts`
- `app/api/strategy/route.ts`
- `components/trading-command-center.tsx`
- `supabase/migrations/202608130006_trade_007_strategy_engine.sql`
- `tests/strategy-engine.test.mjs`

## Owner action

Apply `supabase/migrations/202608130006_trade_007_strategy_engine.sql` after the TRADE-006 migration, then restart the application.

## Verification results

- Production build: passed.
- TypeScript: passed.
- ESLint: passed.
- Tests: passed (43/43).
- Prettier: passed.
- `git diff --check`: passed.

## Safety confirmation

**The Strategy Engine analyzes only. It cannot place or approve an order.**

**PAPER remains the only trading mode and LIVE remains hard locked.**

**No deployment, push, merge, live connection, or real-money transaction was performed.**
