# REAL CHANGE REVIEW — TRADE-016.5 PAPER ORDER EXECUTION CONNECTION HOTFIX

## Root cause

The manual Paper Trading route executed inside Vercel and called `createPaperBroker()`. In hosted production that factory creates the Alpaca PAPER adapter only when Alpaca broker credentials exist in the Vercel process. Those credentials are intentionally Railway-only, so the factory returned `null`. The thrown broker error was then converted by the generic fallback into `The paper broker is unavailable.`

Diagnostics used a different path: it read the Railway Trading Worker heartbeat, whose safe metadata confirmed the Railway-owned Alpaca PAPER connection. Diagnostics was therefore accurate about Railway while the Vercel order route was structurally disconnected from it.

## Previous broken path

Browser → Vercel `/api/broker/orders` → Vercel broker factory → missing Railway-only Alpaca credentials → generic rejection.

The route also attempted direct Alpaca account and quote calls before risk evaluation. A successful broker result was immediately labeled submitted even though no durable worker handoff existed.

## Corrected path

Browser review/confirmation → authenticated Vercel route → owner/input checks → fresh Railway heartbeat → Railway-synchronized PAPER portfolio and Alpaca IEX quote → Production Risk Manager → Trade Permission → owner-scoped durable `QUEUED` execution request → Railway atomic claim → Railway rechecks PAPER, Emergency Stop, system risk lock, approved risk decision, and owning platform order → Railway-only Alpaca PAPER submission → broker lifecycle persisted → UI polling → authoritative Railway portfolio/order/fill synchronization → Portfolio, Active Trades, exposure, open P/L, Position Protection, and completed Trade Journal lifecycle.

A queued request is explicitly not reported as an accepted trade. The visible lifecycle supports REVIEW, SUBMITTING, QUEUED, SUBMITTED, ACCEPTED, PARTIALLY_FILLED, FILLED, REJECTED, CANCELED, and FAILED.

## Durable execution and restart safety

- `(user_id, client_order_id)` is unique in both the existing order reservation and the new execution request.
- The worker claims only `QUEUED` rows using a conditional status update.
- The same client order ID is passed to Alpaca.
- A stale `SUBMITTING` claim is reconciled through Alpaca's client-order-ID lookup before any retry. It is requeued only when Alpaca confirms no matching order exists.
- Risk trade count increments once after a genuine fill through an atomic `risk_counted_at` claim.
- Owners can insert only their own MANUAL/QUEUED requests and read their own lifecycle. They cannot update execution results; Railway's server role owns processing.

## Error categories

- `WORKER_UNAVAILABLE`
- `BROKER_NOT_CONFIGURED`
- `BROKER_AUTH_FAILED`
- `RISK_REJECTED`
- `ORDER_REJECTED`
- `ORDER_TIMEOUT`
- `SYNC_FAILED`

No upstream payload, credential, key, or account secret is returned.

## Database changes

New additive migration:

`supabase/migrations/202608160003_trade_016_5_paper_execution_queue.sql`

It creates:

- `paper_execution_requests`, with owner-scoped insert/select RLS and durable lifecycle/idempotency fields;
- `paper_market_quotes`, with owner-scoped read RLS for Railway-persisted Alpaca IEX prices;
- an additive `orders.broker_order_id` column and supporting indexes;
- the TRADE-016.5 migration marker only after required schema and policies exist.

It does not delete/reset data, weaken RLS, enable LIVE, or modify an already-applied migration.

## Railway changes

The Trading Worker now:

- persists current owner-scoped Alpaca IEX quotes;
- consumes and atomically claims manual PAPER execution requests;
- rechecks safety/risk state before broker access;
- submits through its existing Railway-only Alpaca PAPER credentials;
- safely categorizes Alpaca failures;
- reconciles accepted, partial, filled, rejected, and canceled states;
- preserves authoritative portfolio, protection, active-trade, and journal synchronization.

No Railway environment-variable changes are required. The Trading Worker service must be redeployed after the migration. The Notification Worker remains independent and unchanged.

## Vercel changes

The broker order API no longer creates an Alpaca adapter or requires Alpaca PAPER broker credentials. No Alpaca broker secret should be added to Vercel. Vercel validates and queues; Railway executes.

## Files changed

- `app/api/broker/orders/route.ts`
- `components/trading-command-center.tsx`
- `hosted-worker/index.mjs`
- `src/domain/models.ts`
- `src/services/broker/errors.ts`
- `src/services/diagnostics.ts`
- `src/services/paper-execution.ts`
- `supabase/migrations/202608160003_trade_016_5_paper_execution_queue.sql`
- `tests/trade-016-5-paper-execution.test.mjs`
- `tests/market-data-engine.test.mjs`
- `tests/trade-012-backtesting.test.mjs`
- `tests/diagnostics-migration-fix.test.mjs`
- `tests/diagnostics-production-trace.test.mjs`
- `REAL_CHANGE_REVIEW_TRADE-016.5.md`

## Owner deployment steps

1. Run the complete file `supabase/migrations/202608160003_trade_016_5_paper_execution_queue.sql` in the production Supabase SQL Editor.
2. Deploy the application/Vercel code through the normal owner-controlled process. Do not add Alpaca PAPER broker credentials to Vercel.
3. Redeploy the Railway Trading Worker from the same revision with its existing PAPER-only variables and `npm run worker:start` command.
4. Leave the Railway Notification Worker on `npm run worker:notifications`; no notification-worker configuration change is required.
5. Run Diagnostics. Database migrations should include TRADE-016.5 and the Railway/Alpaca PAPER checks must remain healthy.
6. Only after owner review, use the Paper Trading UI to perform a deliberately controlled PAPER-only verification. Confirm the UI progresses from QUEUED to a broker state and that any genuine fill appears through Portfolio/Active Trades synchronization. This implementation and its automated tests placed no order.

## Test and validation results

- Dedicated TRADE-016.5 regressions cover hosted routing, no Vercel broker secrets, Railway ownership, owner RLS, request idempotency, duplicate claims, restart recovery, risk-before-broker ordering, worker unavailable, safe Alpaca rejection/auth/timeout categories, mocked accepted/partial/filled states, authoritative Portfolio/Active Trades/Protection/Journal integration, and LIVE lock.
- Production build: passed.
- TypeScript: passed.
- ESLint: passed.
- Prettier: passed after formatting the final worker changes.
- Full application tests: 182 passed, 0 failed.
- `git diff --check`: passed.
- Trading Worker ESM/module syntax check: passed.
- Notification Worker ESM/module syntax check: passed.
- `npm run worker:start` and `npm run worker:notifications` resolve to their correct independent entry modules. Configuration-scrubbed smoke runs reached each worker's expected missing-environment guard after module loading; credentials were intentionally removed so neither worker could contact Supabase, Alpaca, or a notification provider during validation.

## Safety

- No PAPER or LIVE order was placed.
- LIVE remains impossible and locked.
- Broker secrets remain Railway-only.
- Risk and trade-permission gates remain mandatory and are rechecked by Railway.
- No code was pushed or deployed.
