# REAL CHANGE REVIEW — TRADE-007.1 + TRADE-008

## Mission summary

Completed the desktop readability scale increase and the first end-to-end automated PAPER trading workflow. Auto Trader can analyze an allowed asset, generate a combined strategy opportunity, filter eligibility, pass the candidate through the Production Risk Manager and TradePermissionService, submit only to a PAPER broker or clearly simulated PAPER adapter, persist the result, create a simulated position when filled, and journal the complete explanation without owner approval.

## TRADE-007.1 desktop scale

- Increased desktop sidebar width, navigation targets, brand mark, typography, financial figures, status badges, buttons, inputs, card rhythm, chart height, modal dimensions, and page spacing by approximately 20%.
- Used explicit responsive CSS properties—no `zoom`, transform scaling, or browser-scale workaround.
- Preserved the existing layout hierarchy and desktop breakpoints.
- Limited the scale pass to screens above 800px; the existing mobile sizing, bottom navigation, Emergency Stop reset, and Auto Trader controls remain responsive.
- Added compact tablet layouts for automated decisions and configuration to avoid horizontal page overflow.

## Auto Trader configuration

Owner-scoped configuration supports:

- Enable, pause, and resume
- PAPER capital allocation
- Maximum trade size and planned risk
- Daily loss and profit limits
- Daily trade and concurrent-position limits
- Minimum normalized strategy score
- Toggleable allowed strategies and assets

All server configuration is validated and persisted in Supabase. Strategy scores remain explicitly labeled as normalized signal strength, not probability of profit.

## Automated PAPER flow

The implemented sequence is:

Market Data → Combined Strategy Opportunity → Auto Trader filters → Production Risk Manager → TradePermissionService → guarded PAPER Broker → execution record → position when filled → journal.

- No owner approval is requested for an eligible enabled Auto Trader candidate.
- Every order is hard-coded to `PAPER` and uses a defined entry, valid stop loss, valid take profit, and calculated maximum planned loss.
- Invalid stop or target geometry is rejected before risk or broker access.
- `REDUCE_SIZE` decisions are resized and risk-checked again before broker submission.
- Paused, disabled, daily-locked, target-reached, system-locked, and Emergency Stop states cannot submit.
- Existing positions are never closed or removed by daily locks or Emergency Stop.

## Broker and simulation behavior

- A healthy IBKR PAPER connection uses the generic IBKR PAPER adapter.
- A disconnected broker uses `SimulatedPaperBrokerService`, which performs no network or broker call and returns `SIMULATED PAPER EXECUTION — no broker order was sent`.
- The UI and persistence distinguish `SIMULATED PAPER` from `IBKR PAPER`.
- A server-side guarded broker rechecks current Emergency Stop and Auto Trader status immediately before submission, blocking already queued work if the safety state changed.
- LIVE remains rejected in the UI, permission layer, order service, guarded adapter, simulated adapter, and IBKR adapter.

## Durable duplicate protection

- Each actionable opportunity receives a deterministic hourly key derived from asset, recommendation, supporting strategies, and evaluation bucket.
- `(user_id, opportunity_key)` is unique and claimed before strategy history, risk evaluation, or broker access.
- Failed claims return `DUPLICATE_OPPORTUNITY` and cannot submit.
- Automated execution, order, and position records are unique per automated decision.
- Reconnect retries and previously completed opportunities therefore cannot execute twice.

## Persistence and explainability

Added owner-scoped RLS persistence for:

- Auto Trader configuration
- Daily state, P/L, trade count, wins/losses, deployed capital, and lock reason
- Automated decisions and durable opportunity claims
- Strategy opportunity and signal references
- Risk decision reference
- Automated PAPER order and execution result
- Simulated filled position
- Explainable journal entry

Each decision records strategy support, signal strength, risk result/reason, capital, maximum planned loss, entry, stop, target, source, timestamp, and result status (`EXECUTED`, `REJECTED`, `SKIPPED`, `REDUCED`, or `LOCKED`).

## Auto Trader dashboard

- ACTIVE, PAUSED, LOCKED, TARGET REACHED, and PAPER status
- Allocated, deployed, and available Auto Trader capital
- Today’s P/L, target, loss limit, trade count, and win/loss count
- Minimum signal-strength score
- Active strategy and allowed-asset controls
- Recent explainable automated decisions and execution source
- Clear daily-loss and daily-target banners stating that existing positions remain manageable

## Main files

- `src/services/auto-trader.ts`
- `src/services/broker/guarded-paper-broker-service.ts`
- `src/services/broker/simulated-paper-broker-service.ts`
- `app/api/auto-trader/route.ts`
- `components/trading-command-center.tsx`
- `app/globals.css`
- `supabase/migrations/202608140001_trade_008_auto_trader.sql`
- `tests/auto-trader.test.mjs`

## Owner action

Apply `supabase/migrations/202608140001_trade_008_auto_trader.sql` after the TRADE-007 migration, then restart the application. Auto Trader defaults to disabled and PAPER-only.

## Verification results

- Production build: passed.
- TypeScript: passed.
- ESLint: passed.
- Full test suite: passed (53/53).
- Prettier: passed.
- `git diff --check`: passed.

## Safety confirmation

**LIVE trading remains impossible. Auto Trader can submit only confirmed PAPER requests after both risk and permission approval.**

**No deployment, push, merge, live-account action, or real-money transaction was performed.**
