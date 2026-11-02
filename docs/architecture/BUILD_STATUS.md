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
