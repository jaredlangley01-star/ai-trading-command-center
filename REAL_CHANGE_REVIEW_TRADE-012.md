# REAL CHANGE REVIEW — TRADE-012

## Outcome

TRADE-012 replaces the Backtesting placeholder with an owner-authenticated, fully hosted historical simulation workflow. Vercel queues jobs in Supabase; Railway retrieves paginated Alpaca IEX OHLCV bars, runs deterministic simulations, and persists progress, metrics, curves, assumptions, and trade history. No backtesting code imports or invokes a broker.

## Files changed

- `src/services/backtesting/historical-data.ts`: Alpaca IEX range/pagination client and OHLCV normalization for 1Min, 5Min, 15Min, 1Hour, and 1Day.
- `src/services/backtesting/engine.ts`: deterministic portfolio/trade simulator and performance calculations.
- `src/services/strategies/combined-opportunity-engine.ts`: extracted shared production signal combination function.
- `app/api/backtests/route.ts`: authenticated queue/history API.
- `hosted-worker/index.mjs`: asynchronous job claiming, restart recovery, execution, and persistence.
- `components/trading-command-center.tsx`: configuration, progress/history, metrics, actual equity/drawdown curves, comparison, and simulated trades.
- `supabase/migrations/202608140006_trade_012_backtesting.sql`: durable jobs/results/trades and owner RLS.
- `tests/trade-012-backtesting.test.mjs`: normalization, simulation, safety, persistence, and hosted-worker coverage.

## Historical-data architecture

The Railway worker calls Alpaca's `/v2/stocks/{symbol}/bars` endpoint with explicit start, end, timeframe, `feed=iex`, ascending order, and pagination. Bars are normalized to timestamp/open/high/low/close/volume. Empty data and HTTP 403 return typed limitations; missing bars are never fabricated.

## Backtesting architecture

Momentum, Breakout, Trend Following, and Mean Reversion instantiate the exact production strategy classes. Combined Opportunity evaluates those same modules and uses the same exported production signal combiner. Each evaluation receives only `candles.slice(0, current + 1)`. A close signal enters at the next bar's open, preventing future-bar entry decisions.

Supabase states are `QUEUED`, `RUNNING`, `COMPLETED`, and `FAILED`. Railway atomically changes a QUEUED row to RUNNING before work. Runs left RUNNING by a crash are requeued after ten minutes. Trade rows use `(backtest_id, trade_index)` uniqueness, so retries remain idempotent.

## Simulation assumptions

- Default position size: 10% of available capital.
- Default stop/target: 2% / 4%.
- Default slippage: 5 basis points on entries and exits.
- Default commission: 0 per side, configurable.
- Signal timing: candle close, next-candle open entry.
- When a candle touches both stop and target, the stop is applied first as a conservative assumption.
- Strategy reversal, stop, target, and end-of-data exits are supported for LONG and SHORT simulations.
- Maximum concurrent positions is recorded; the initial single-symbol engine supports one active position at a time.

## Results and persistence

Persisted output includes configuration, status/progress, strategy version, source/timeframe/period, assumptions, complete metrics, equity curve, drawdown curve, and every simulated trade. The dashboard reports return, win rate, profit factor, drawdown, Sharpe, trade count, detailed trade history, and multi-metric strategy comparison. Historical results are explicitly not forecasts.

## Known Alpaca/IEX limitations

Historical availability depends on the connected Alpaca plan, feed entitlements, symbol history, timeframe, and requested dates. IEX represents IEX exchange data rather than the full consolidated US market. The engine reports unavailable/forbidden historical data and does not substitute demo candles.

## Safety

Backtests cannot place PAPER or LIVE orders, alter positions, trigger Auto Trader or Big Money, or update production risk settings. LIVE remains hard locked and the hosted path contains no localhost, IBKR, TWS, bridge, or owner-PC dependency.

No deployment or broker order was performed.
