# Build Status — Milestone 2

Status: source scaffold committed; not deployed or broker-connected.

Implemented: typed market/proposal/decision models; research freshness gate; four transparent strategy evaluators; deterministic PAPER-only risk gate; shared specialist agent roles and orchestrator; initial risk tests.

Not yet implemented: live market-data adapter; historical-bar storage; broker account reconciliation or PAPER order execution; position lifecycle worker; persistent database; scheduler; dashboard; deployment; runtime monitoring.

The strategy evaluators are basic baseline formulas, not evidence of profitability. The risk gate rejects proposals exceeding limits rather than silently resizing them. This scaffold cannot place orders.

Local setup requires Python 3.12+ and pytest. Install the project with the test extra, then run pytest from the repository root. No credentials or paid services are needed for these unit tests.


## Milestone 3: observation pipeline

Implemented a market-data provider contract, deterministic in-memory fixture provider, observation-only cycle runner, stoppable scheduler loop and cycle tests.

The scheduler can repeatedly scan configured symbols in a long-running process. It is not yet a production hosted worker: there is no durable state, process supervision, market calendar, heartbeat store or deployment configuration.

## Current hard limits

- No external market-data API is connected.
- No broker adapter or order-submission code exists in this new foundation.
- The in-memory fixture is test data, not real quotes.
- The cycle is observation-only and cannot place orders.
- No cloud resources or paid services have been provisioned.
- The strategy evaluators are basic baseline formulas and have no demonstrated edge.

## Next implementation target

Add persistent audit/event storage and a broker adapter interface with a PAPER-only fake broker for lifecycle testing. Then evaluate the actual broker's current eligibility, data coverage and free-tier constraints before wiring a real paper account.


## Verification notes

A review identified and corrected two simulator/test-foundation issues: the in-memory SQLite test store now shares one named in-memory database across connections, and the simulated broker rejects reuse of an idempotency key for a different order payload. The source has been updated, but automated tests have not yet been executed in a Python runtime. Do not treat the implementation as verified until CI or a local Python 3.12+ test run passes.


## Milestone 5: position lifecycle

Added an event-backed position ledger, simulated-fill validation, position marking, long/short P&L calculation, idempotent close events, and deterministic stop-loss, take-profit and end-of-day exit checks. Initial tests cover long position open/mark/close, stop-loss, end-of-day exit, duplicate close and rejection of non-simulated fills.

## Important limitations

- Broker remains a local simulator; no Alpaca/IBKR API is connected.
- Simulated fills use proposal entry price; no bid/ask, slippage, partial fills, fees, liquidity or market impact.
- No real-time market-data source is connected.
- End-of-day close only acts when called with a current price; there is not yet an exchange calendar, cutoff scheduler, quote refresh or broker-side protective order.
- Position ledger is event-backed but not yet multi-process safe as a complete trading system.
- No cloud deployment or paid service has been provisioned.
- Strategy baselines are not evidence of profitability.
- Automated tests are authored but successful execution has not yet been confirmed.

## Next milestone

Add account/portfolio reconciliation, dashboard read API, system heartbeat and runtime checks. Then run CI, review broker eligibility/data access for the user's jurisdiction, and only after that connect a real PAPER account.


## Milestone 6: read-only portfolio and health snapshots

Added a read-only portfolio snapshot for open simulated positions, gross exposure, realised P&L from the position ledger, and unrealised P&L using the latest recorded mark (or entry price when unmarked). Added heartbeat recording and a health snapshot that reports UNKNOWN, OK, DEGRADED, ERROR or STALE based on the most recent heartbeat. Fixed execution idempotency lookup to use the SQLite event-key index rather than scanning only the latest 10,000 events.

Important accounting limitation: the simulator does not settle cash when a position is closed. The portfolio snapshot therefore explicitly labels broker cash as unsettled and reconciliation as NOT_RECONCILED. It does not calculate or display account equity. This is not a broker account statement.

The heartbeat classes are library components only; no hosted process is currently recording heartbeats. The dashboard/API, real quote source, real broker PAPER connection, production scheduling, deployment and test execution remain outstanding. No live trading path was added.

## Milestone 7: read-only dashboard API

Added a small standard-library HTTP API with read-only /api/status, /api/portfolio and /api/health routes. It has no order submission, modification or cancellation routes. Added an automated test that verifies the API reports simulator-only mode and rejects an orders route.

## Milestone 8: first dashboard interface

Added a separate Next.js page at /small-trading. The interface includes portfolio summary placeholders, open positions, system health, six agent roles and recent activity. It deliberately displays unknown/not-connected states instead of invented account values. It clearly states PAPER SIMULATOR and LIVE LOCKED. This is a frontend scaffold: it is not yet wired to the Python API, broker, market data or a deployed worker.

Added a Node.js/TypeScript CI job alongside the Python engine tests. The Python test suite has passed. Frontend type-check/build validation is pending its first CI result.

## Current limitations and next steps

- Dashboard page is not yet connected to live service data.
- The Python API is a local library/server factory and is not deployed or hosted.
- No real market-data feed or broker PAPER account is connected.
- The portfolio simulator is not reconciled accounting; its cash and P&L must not be treated as an account statement.
- No live trading is enabled or implemented in this rebuild.
- Next: finish frontend CI validation, wire a safe read-only data bridge, then research and verify market-data/broker eligibility and genuinely free hosting options for a South African user.
