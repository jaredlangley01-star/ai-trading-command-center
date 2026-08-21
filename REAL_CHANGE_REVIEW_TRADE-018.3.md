# REAL CHANGE REVIEW — TRADE-018.3

## Outcome

Recovered the hosted PAPER automation path without placing an order, deploying, or enabling LIVE. The changes keep Alpaca PAPER credentials in Railway, preserve Risk Manager and TradePermissionService enforcement, and preserve the TRADE-015.1 native Node ESM `.ts` import fix for all workers.

## Exact root causes

1. **False stale-data rejection.** Alpaca IEX snapshots can contain a newer quote and an older last trade. Quote normalization and worker quote persistence selected the trade timestamp first. The Auto Trader then compared that older timestamp with the generic 30-second freshness limit, rejecting valid current quote activity as `STALE_MARKET_DATA`.
2. **Normal threshold overriding test mode.** Test mode applied its opportunity and confidence settings but left `minimumStrategyScore` at the normal value (70 in the owner row). A valid 61-point test candidate was therefore skipped even though the explicit test-mode minimum was 60.
3. **Heartbeat flapping.** A heartbeat was written only after the entire cycle, including research, network calls, reconciliation, and queue work. A slow cycle could exceed the notification worker's 120-second stale threshold. Recovery was emitted as soon as any heartbeat returned, creating repeated offline/recovered noise.
4. **Incomplete configured-universe use.** The shared Alpaca snapshot batch and heartbeat used the four-symbol worker environment fallback even when the owner had a larger persisted test universe.
5. **Visibility defects.** The heartbeat counted all returned broker orders as open, including history. Confirmed fill exports did not include stress-mode/test-slot metadata.

Read-only production inspection confirmed one owner-scoped `auto_trader_config` row, `paper_test_mode = true`, target 8, normal score 70, test score 60, and the persisted 12-symbol test universe. No broker order was submitted during investigation or validation.

## Corrected path

- Alpaca normalization chooses the newest valid quote/trade provider timestamp and retains separate quote, trade, bar, receive, and evaluation timestamps.
- Alpaca IEX entries retain stale-data protection with a two-minute minimum threshold; genuinely old data remains rejected.
- Every automated decision can persist safe market-data audit metadata: source, bar/quote/trade timestamps, receive/evaluation time, age, threshold, and fresh/stale state.
- Test mode now atomically applies its universe, opportunity score, confidence, position-size, per-trade-risk, daily-trade, and effective strategy-score limits. Safety maxima are only tightened, never expanded.
- The worker loads the union of persisted owner universes for market snapshots and reports configured/evaluated coverage.
- Slot logic remains `target - confirmed Alpaca positions - active durable requests`; 0/8 seeks 8, 5/8 seeks 3, and 8/8 stops new entries. Duplicate symbols, exposure, position count, Risk Manager, TradePermissionService, emergency stop, and protection gates remain intact.
- Manual stress execution cannot fall back to a simulated broker. A disconnected real PAPER broker returns `BROKER_UNAVAILABLE`.
- A periodic non-overlapping heartbeat runs independently of the long cycle. Structured logs cover cycle start/end/duration, heartbeat writes, Alpaca duration, queue duration, and nonfatal cycle errors.
- Engine-offline notification detection now uses a 180-second minimum and recovery hysteresis.
- Each enabled owner receives an owner-safe persisted production cycle trace with target/current/seeking positions, session state, universe, evaluated/fresh/stale/eligible/risk/queue/submission/fill counts, and last block reason.
- The dashboard shows `ACTIVE X/8 — SEEKING Y`, target reached, and the concise last block reason.
- Confirmed stress fills persist `paper_test_mode` and `test_slot`; orders and fills CSV exports include those fields.

## Schema change

Apply the additive migration:

`supabase/migrations/202608210001_trade_018_3_execution_recovery.sql`

It adds JSON audit fields to `automated_decisions` and stress metadata to `paper_broker_fills`, then records the migration ledger version. Existing owner RLS remains in force; no credentials are stored.

## Owner deployment steps

1. Apply the new Supabase migration.
2. Deploy the Vercel application build.
3. Redeploy the Railway trading worker and notification worker from the same revision. No new secret is required.
4. Confirm Railway retains `HOSTED_PRODUCTION`, `BROKER_ADAPTER=ALPACA_PAPER`, `ALPACA_BROKER_ENVIRONMENT=PAPER`, and its existing server-only Alpaca/Supabase credentials.
5. During the allowed regular-market entry window, confirm the Auto Trader panel reports `PAPER AUTOMATION TEST — ACTIVE`, target/current/seeking counts, and a specific last block reason when no entry qualifies.
6. Verify new activity in Orders, Portfolio, Active Trades, Recent Fills, and the CSV exports. Do not infer a fill from a queued or accepted order.

## Validation

- Production build: passed.
- TypeScript: passed.
- ESLint: passed.
- Prettier: passed.
- Full test suite: 267 passed, 0 failed.
- Worker syntax check: passed.
- `npm run worker:start`, `npm run worker:notifications`, and `npm run worker:trader`: all loaded through native Node TypeScript ESM successfully with safe placeholder validation settings and were then stopped; no `ERR_MODULE_NOT_FOUND` occurred. The trading worker's expected placeholder-network failure was contained as nonfatal and did not terminate its loop.
- `git diff --check`: passed.

## Known limitations

- No real Alpaca PAPER order was submitted during Codex validation, by requirement. Broker acceptance/fill behavior is covered with mocked and existing lifecycle tests; production confirmation must occur during the owner-authorized entry window.
- Closed market, closed entry window, absent signals, risk limits, duplicate-symbol limits, unavailable broker, or genuinely stale data will correctly leave slots unfilled and surface the corresponding block reason.

READY FOR OWNER REVIEW
