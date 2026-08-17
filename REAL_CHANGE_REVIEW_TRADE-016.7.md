# REAL CHANGE REVIEW — TRADE-016.7

## Outcome

The authenticated Trading Command Center now has one visual execution monitor for manual, Auto Trader, and Big Money PAPER orders. It reads actual owner-scoped Supabase lifecycle records and never fabricates orders.

## Order state architecture

`orders` stores the platform order. `paper_execution_requests` stores durable Railway ownership and broker lifecycle timestamps. Railway remains the only broker-writing service and synchronizes Alpaca's non-terminal and terminal states on every normal worker cycle.

The monitor preserves `REVIEW`, `QUEUED`, `PROCESSING`, `SUBMITTED`, `ACCEPTED`, `PARTIALLY_FILLED`, `FILLED`, `POSITION_OPEN`, `CANCELED`, `REJECTED`, `FAILED`, and `EXPIRED`. `ACCEPTED` never implies filled. An accepted LIMIT order explicitly says `WAITING FOR LIMIT PRICE`.

## Orders page and timeline

- Added authenticated **Orders** navigation between Paper Trading and Trade Journal.
- Added ALL, PENDING, OPEN, FILLED, CANCELED, REJECTED, and FAILED filters.
- Shows symbol, side, quantity, type/limit, source, classification, exact state, timestamps, safe broker ID, fills, average price, and sanitized errors.
- Detail timeline uses only persisted timestamps for Created, Risk Approved, Queued, Railway Worker, Submitted, Accepted, Filled, Position Open, and Closed.
- Links the owner to Portfolio and Trade Journal when real linked records exist.
- Shows `WORKER DELAYED` for an unclaimed queue item after two minutes without prematurely failing it.

## Global and Dashboard visibility

- Added independently polled `PENDING ORDERS: n` beside Active Trades; it opens the PENDING Orders filter.
- Added a compact Dashboard Order Activity card for pending, accepted, partial, filled today, and rejected today.
- Manual Paper Trading exposes **VIEW ORDER** during lifecycle polling.

## Auto Trader and Big Money

Auto Trader and Big Money now enqueue into the same `orders` and `paper_execution_requests` lifecycle used by manual PAPER orders. Sources and classifications are persisted as `AUTO_TRADER / SMALL` and `BIG_MONEY / BIG`. Risk and TradePermissionService still run before queue creation; Railway revalidates risk/permission before Alpaca submission.

The Auto Trader activity panel reports authoritative state, current activity, last Railway scan, candidates evaluated/rejected, last safe rejection reason, last queued order, last fill, and Railway acknowledgement. ACTIVE with no open position remains `SCANNING / WAITING FOR SETUP` and does not imply a trade.

## Queue recovery and broker synchronization

- `SUBMITTING` claims remain unique and restart-safe.
- Railway checks Alpaca by `client_order_id` before retrying a stale claim.
- Only broker-confirmed 404 claims return to QUEUED.
- Completed requests cannot be reclaimed by the QUEUED claim.
- Alpaca `accepted → partially_filled → filled/canceled/rejected` transitions, fill quantity, and average fill price are synchronized.
- TRADE-016.6 session/freshness checks remain active at queue admission and immediately before MARKET submission.

## Notifications and diagnostics

Important lifecycle transitions enqueue deduplicated events for queued, accepted, filled, rejected, and canceled orders. Existing notification preferences, cooldown, and delivery policy remain authoritative.

Diagnostics now reports execution-queue pending count and delayed pre-claim requests. A legitimate accepted limit order waiting for price does not degrade platform health.

## Persistence

Added `supabase/migrations/202608170002_trade_016_7_order_monitor.sql`. It is additive and records lifecycle timestamps, fill details, classification, and Order → Position → Completed Trade → Journal linkage.

## Safety

- PAPER only; LIVE remains locked.
- No strategy/risk thresholds were changed.
- No broker order was placed during implementation or validation.
- No credentials or internal tokens are exposed.
- Position protection remains independent of Auto Trader state.
- TRADE-015.1 native TypeScript ESM imports and both Railway start commands are preserved.

## Validation

Automated coverage includes lifecycle states, filters, timeline accuracy, pending counts, Dashboard summary, manual/Auto Trader/Big Money visibility, linkages, stale-claim recovery, restart idempotency, broker polling, notifications, responsive behavior, secret hygiene, and LIVE lock.
