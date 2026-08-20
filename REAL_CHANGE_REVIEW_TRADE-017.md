# REAL CHANGE REVIEW — TRADE-017

## Outcome

TRADE-017 aligns the hosted PAPER platform with two explicit holding models:

- **AUTO TRADER — DAY TRADING:** configurable entry start/cutoff, maximum hold, signal deterioration exits, and mandatory end-of-session liquidation.
- **BIG MONEY — MULTI-DAY:** continuously monitored by the existing position manager but exempt from Auto Trader end-of-day closure.

LIVE remains locked.

## Intraday lifecycle

- Added timezone-aware session utilities with no hard-coded UTC offset.
- Default entry window is 09:35–15:15 America/New_York; forced exit begins at 15:50.
- New entries outside the intraday window are rejected before the existing strategy/risk/permission/broker pipeline.
- Auto Trader exits now include stop, target, signal weakened, signal reversed, strategy invalidated, risk, maximum hold, end of session, manual, and emergency reasons.
- Pending Auto Trader entry orders are canceled during the closing phase.
- Durable exit claims reconcile by client order ID and safely retry confirmed failed submissions.
- Big Money positions are not passed through intraday expiry logic.

## Protection audit

- Planned stop/target values flow from durable execution requests into synchronized positions.
- Positions expose `PROTECTED` or `UNPROTECTED` and `WORKER-MONITORED` protection.
- Missing expected protection creates a deterministic critical alert without AI.

## Strategy analytics

- Live Auto Trader PAPER performance is separated from historical backtests and Big Money trades.
- Added wins/losses, win rate, realized P/L, average/largest win/loss, profit factor, expectancy, drawdown, duration, and exit-reason frequencies.
- Health states use a configurable minimum sample: NOT ENOUGH DATA, HEALTHY, WATCH, UNDERPERFORMING, or PAUSE RECOMMENDED.

## CSV exports

- Added authenticated owner-scoped exports for Journal, Orders, Fills, live PAPER strategy performance, and Backtests.
- CSV formula injection is neutralized and only explicitly selected non-secret columns are emitted.

## Trader assistant

- Added a persistent authenticated in-site Trader panel.
- Trader receives structured owner-scoped Portfolio, position, order, recommendation, risk, Auto Trader, strategy, diagnostics, and notification data.
- Optional AI synthesis receives only verified structured context. Without AI variables, deterministic responses remain available.
- Trader cannot import or call broker execution, approve recommendations, bypass Risk Manager, or change LIVE state.
- Strategy ideas persist as DRAFT and cannot become active silently.
- Context links navigate to existing authenticated workflows.

## Proactive hosted worker

- Added separate `/railway.trader.json` and `npm run worker:trader`.
- The worker creates significant, cooldown-controlled, deduplicated messages for unprotected positions, risk locks, Big Money recommendations, and unhealthy strategies.
- It has no broker dependency or broker credentials.

## Database

- Additive migration: `supabase/migrations/202608200001_trade_017_intraday_trader.sql`.
- Adds intraday settings, protection fields, owner-scoped Trader messages/proposals, Trader heartbeat, RLS, and expanded exit reasons.

## Safety

- PAPER only.
- LIVE hard lock preserved.
- Existing TradePermissionService and Risk Manager entry path preserved.
- AI and Trader remain outside broker execution.
- No broker order was placed during implementation or validation.
- No deployment, push, or merge was performed.

## Verification

- Production build: passed.
- TypeScript (`npm run typecheck`): passed.
- ESLint (`npm run lint`): passed.
- Full test suite (`npm run test`): 230 passed, 0 failed.
- Prettier (`npm run format:check`): passed.
- `git diff --check`: passed (line-ending notices only).
- Railway trading worker (`npm run worker:start`): started successfully with no ESM resolution error.
- Railway notification worker (`npm run worker:notifications`): started successfully with no ESM resolution error.
- Hosted Trader worker (`npm run worker:trader`): started successfully with no ESM resolution error.
- Native Node syntax checks passed for all three hosted worker entrypoints.
