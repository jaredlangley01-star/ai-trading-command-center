# REAL CHANGE REVIEW — TRADE-018

## Outcome

Added an owner-controlled PAPER Automation Test mode that aggressively exercises the real hosted Alpaca PAPER pipeline without synthetic positions or fills. The mode defaults OFF and LIVE remains hard locked.

## Automation behavior

- Configurable default 8-position Auto Trader target, bounded by the normal concurrent-position limit.
- Repeated hosted scans fill only available slots; confirmed positions and pending durable requests both consume slots.
- Existing broker symbols and pending symbols are excluded to prevent duplicates.
- Genuine candidates remain subject to market-data, deterministic strategy, Risk Manager, TradePermissionService, durable claims, hosted-runtime, and Alpaca PAPER guards.
- Test thresholds and universe are isolated from normal settings.
- Under-tested strategies receive ranking preference only when candidates are already genuinely eligible.
- Closed positions free a slot on the next cycle; TRADE-017 monitoring, maximum hold, signal exits, protection, and end-of-day exit remain unchanged.
- Unprotected Auto Trader positions block additional stress entries and retain critical warning delivery.

## Big Money

- Separate Big Money test mode, target, and auto-approval preference default OFF.
- Deterministic eligibility helper requires PAPER, qualifying research, score threshold, and an available confirmed slot.
- Normal Big Money approval behavior remains unchanged when test auto-approval is OFF.

## Visibility and audit

- Dashboard shows test state, confirmed Auto Trader/Big Money counts, total positions, capital, open P/L, protection warning, and strategy coverage.
- Trader supports confirmed start/stop PAPER test controls without broker access.
- Execution requests and completed trades persist test flag, slot, candidate rank, selection reason, and thresholds.
- CSV Journal and Orders exports expose the new non-secret audit fields.
- Additive owner-scoped test-cycle metrics table with RLS records status and coverage.

## Safety

- No fake or local-only positions count as active; a persisted Alpaca broker identifier is required.
- Stress mode cannot run outside PAPER/ALPACA_PAPER or when LIVE is enabled.
- Stop mode blocks new stress entries and does not abandon existing positions.
- No broker order was placed during implementation or validation.
- No deployment, push, merge, or LIVE enablement was performed.

## Database

- Apply `supabase/migrations/202608200002_trade_018_paper_automation_stress.sql` before deployment.

## Verification

- Production build: passed.
- TypeScript: passed.
- ESLint: passed.
- Full test suite: 245 passed, 0 failed.
- Prettier: passed.
- `git diff --check`: passed (line-ending notices only).
- Native Node syntax validation: passed for all hosted workers.
- `npm run worker:start`: remained running with Railway-compatible native ESM resolution; stopped manually after verification.
- `npm run worker:notifications`: remained running with Railway-compatible native ESM resolution; stopped manually after verification.
- `npm run worker:trader`: remained running with Railway-compatible native ESM resolution; stopped manually after verification.
