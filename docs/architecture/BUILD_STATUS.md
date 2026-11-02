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

## Milestone 9: Alpaca IEX market-data adapter

Added an authenticated, read-only adapter for Alpaca's stock-bars API. It defaults to and enforces the IEX feed, requires credentials from environment variables, normalizes timestamps to UTC, returns chronological bar windows, and distinguishes missing data, authentication failures, rate limits and network errors. It cannot submit broker orders.

The adapter has automated tests for missing credentials, rejection of non-IEX feeds, snapshot parsing and empty data. CI is running for this change.

Broker/data research: Alpaca documents that anyone globally can create a paper-only account, which is restricted to IEX market data. Alpaca's free Basic equity data is IEX-only, with 30 websocket symbol subscriptions and 200 historical API calls per minute. IEX is not the consolidated all-exchange US market feed. Account and service eligibility should still be confirmed during signup. See official docs: https://docs.alpaca.markets/us/docs/paper-trading and https://docs.alpaca.markets/us/docs/about-market-data-api.

Hosting research: Render free web services sleep after 15 minutes of inactivity and have ephemeral local filesystems; Vercel Hobby cron runs only once per day; Cloudflare Workers free limits include 100,000 requests/day but only 10ms CPU per request. These constraints mean none should be presented as a reliable always-on trading worker. A free-first UI may be possible, but reliable 24/7 execution may ultimately require a paid always-on worker or a carefully constrained serverless design. No service has been provisioned and no costs incurred.


## Milestone 11: dashboard API access guard

The dashboard API binds to loopback by default. Non-loopback binds are refused unless SMALL_TRADING_API_TOKEN is configured. When configured, all GET routes require a matching Authorization: Bearer token. Responses include no-store caching and nosniff headers. Automated tests cover local read-only behaviour, refusal of unprotected external binding, and bearer-token enforcement.

CI run 41444205207 passed both Python tests and dashboard type-check before this security change. The new guard changes require a fresh CI run before they are considered verified.

## Current status (2026-11-02)

- Alpaca IEX market-data adapter: committed; tests passed in CI.
- Alpaca Paper account reader: committed; unit tests passed in CI.
- Dashboard API: read-only routes plus local-only default and bearer-token guard; latest security-guard changes awaiting CI.
- Dashboard UI: scaffold only; not yet wired to the Python API or broker.
- No Alpaca credentials configured; no broker account connected.
- No hosted worker, deployment, or cloud resource provisioned.
- No orders placed; live trading is not implemented.
- Strategy evaluators remain baseline rules, not validated profitable strategies.


## Milestone 12: observation-only worker runtime

Added a persistent-process worker that scans configured symbols, runs the existing observation cycle, records strategy signals and errors as SQLite events, and writes health heartbeats. It supports a one-cycle diagnostic and a recurring scheduler loop. The worker has no execution gateway and cannot submit orders. The Alpaca provider is IEX-only and read-only.

Configuration is server-side: APCA_API_KEY_ID, APCA_API_SECRET_KEY, SMALL_TRADING_SYMBOLS, SMALL_TRADING_SCAN_INTERVAL_SECONDS, and SMALL_TRADING_DATABASE_PATH. The worker is not deployed and has not yet been run against a connected Alpaca account. CI is pending for the new worker tests.

## Verification update

CI run 41444444296 passed the dashboard API security guard, existing Python tests and dashboard type-check. The new worker code and tests were committed after that run and require their own successful CI run.


## Milestone 13: server-side dashboard connection

Added a same-origin Next.js API proxy for the read-only Python dashboard API. The proxy allow-lists status, health, portfolio and broker resources; only supports GET; disables caching; enforces HTTPS for non-local backend URLs; and keeps the bearer token in server environment variables. The dashboard now polls the backend status every 15 seconds and displays backend reachability, worker heartbeat, open simulated-position count and reconciliation status. Missing configuration is shown as NOT CONNECTED rather than fabricated account data.

Required Next.js server environment variables are SMALL_TRADING_BACKEND_URL and SMALL_TRADING_API_TOKEN. The Python API must use the matching token. Never expose either variable with a NEXT_PUBLIC_ prefix. See docs/architecture/DASHBOARD_CONNECTION.md.

The UI proxy and polling changes are committed but awaiting CI type-check. No backend URL, credentials, broker account, hosting or deployment has been configured.


## Milestone 14: worker runtime and container packaging

Added the `small-trading-worker` command with a `--once` diagnostic mode, graceful SIGINT/SIGTERM shutdown, and guaranteed SQLite connection cleanup. Added tests for one-shot success/failure and service lifecycle. Added a non-root Python 3.12 container image with a persistent `/data` volume and Docker build verification in CI. The image is built for testing only; it is not pushed to a registry or deployed.

CI run 41444838371 passed the dashboard proxy/type-check and Python tests before the runtime/container changes. CI run 41445050237 is the verification run for the runtime/container milestone and is currently queued.

## Deployment readiness

The worker can now be packaged consistently, but it still needs a persistent host with durable storage, server-side secrets, restart policy, and secure network path to the dashboard. No provider has been selected or provisioned, no container image has been published, and no charges have been incurred. Alpaca account credentials are not configured. No broker account is connected and there is no order execution in this worker.


## Milestone 15: read-only worker activity feed

Added an authenticated GET-only `/api/events` endpoint with a bounded limit (1–100), connected it to the API process's shared SQLite event store, and allowed the resource through the Next.js server-side proxy. The dashboard now renders recent observation cycles, strategy evaluation counts, worker errors and heartbeats, refreshing every 15 seconds. The activity feed has no trading controls. Tests cover event retrieval and invalid limits.

CI run 41445582388 passed all three jobs (Python tests, dashboard type-check and container build) for the preceding worker/API milestone. The activity-feed changes are committed; their CI run is pending.

## Current operational truth

The worker and API are separate processes and must share the same durable database path for heartbeat and activity visibility. The broker panel reads Alpaca Paper account information only when credentials are configured. The portfolio endpoint still represents the local simulator and is explicitly NOT_RECONCILED; it must not be interpreted as the real broker account. No Alpaca credentials are configured, no host is provisioned, and nothing is deployed. The worker remains observation-only; there is no live execution path.


## Milestone 16: auditable market observations

Each observation-cycle event now stores the market price, source, bar timestamp and volume used for strategy evaluation, alongside all four strategy outcomes and reasons. Cycle reports expose the same market metadata, and the dashboard activity feed displays the observed price and data source. Tests assert that fixture observations preserve this metadata. Fixture data remains explicitly labelled IN_MEMORY_FIXTURE and must not be mistaken for live market observations. The change is committed; CI verification is pending.

The dashboard activity feed also renders each of the four strategy outcomes with its status and score. Scores are heuristic ranking values from baseline formulas, not probabilities or expected returns.


## Milestone 17: consistent and freshness-gated market observations

The Alpaca IEX adapter now fetches one chronological bar window per symbol and derives both the latest snapshot and the strategy close history from that same response. This avoids two separate requests returning mismatched market moments and halves the normal historical-bar request count for each scan. The observation cycle uses this atomic interface where available and retains a compatibility fallback for simple providers.

The existing Research Agent freshness gate blocks data older than 120 seconds or with invalid price/time geometry. New tests cover the single-fetch contract and stale-data rejection. The in-memory provider remains clearly labelled as a fixture. CI verification for this milestone is pending.

This remains observation-only. No live/paper order submission is enabled by this worker. The adapter has not yet been connected to user credentials or run against an actual Alpaca account.


## Milestone 18: read-only market freshness diagnostics

Added an authenticated GET-only /api/market endpoint that reads recent observation events and reports the latest recorded bar per symbol, its source, timestamp, price, age and FRESH/STALE state. The dashboard now polls and displays this information, using the same 120-second freshness threshold as the Research Agent. Missing data is shown as UNKNOWN rather than a fabricated feed status. Added an API test for latest-per-symbol selection and freshness.

The endpoint reports the latest data already recorded by the worker; it does not itself fetch market data or guarantee that the worker is running. Alpaca IEX and fixture data remain distinguishable by source. CI verification is pending.


## Milestone 19: authoritative US market session clock

Added a read-only Alpaca Paper API clock reader (GET /v2/clock), a protected dashboard API route, and a dashboard display for OPEN/CLOSED/UNKNOWN plus next open and close in US Eastern Time. This deliberately avoids estimating exchange sessions from weekdays, which would mislabel market holidays and exceptional closures. The clock requires an Alpaca Paper connection; without credentials the UI correctly displays UNKNOWN. Tests cover the clock adapter and API route. CI verification is pending.


## Milestone 20: two-service container deployment bundle

Added a Docker Compose deployment definition for the observation worker and read-only API. Both services use the same named persistent volume and database path; the API is exposed only on the internal Compose network, not published to the host. Added a placeholder-only environment template, ensured the real local environment file remains Git-ignored, documented private-network requirements for the Next.js proxy, and added a CI Compose configuration validation job.

This is a reproducible deployment bundle for a single Docker host, not a hosted deployment. No cloud provider, domain, paid service, broker credentials or account has been activated. Compose validation and the updated application checks are pending.


## Milestone 21: single-service hosted runtime and Render blueprint

Added `trading_engine/app_runtime.py`, which starts the observation worker and read-only dashboard API in one process/container, shares one configured SQLite database path on one persistent disk, binds the API to the platform-provided port, handles termination signals, and fails the service if either runtime thread stops. Added tests for platform-port binding and preservation of explicit configuration.

Added `render.yaml` as an optional single-service deployment blueprint. It specifies a paid Starter web service, a 1 GB persistent disk, generated API bearer token, IEX market data configuration, and private secret inputs for Alpaca credentials. The health-check route is a minimal `/healthz` response that does not reveal account or worker data and does not require the bearer token. The full API remains token-protected.

The first CI run for the combined runtime, health-check endpoint, Render blueprint, Docker Compose config and frontend passed all five jobs: Python tests, dashboard TypeScript type-check, Docker build, Compose config validation, and Render YAML syntax validation (run 41450305621). A subsequent review found and corrected the Render feed variable name so it matches the Alpaca adapter's `APCA_DATA_FEED` setting. That one-line correction is committed after the passing run and requires a fresh CI run.

No Render service has been created, no paid plan approved, no Alpaca credentials configured, and no broker account connected. The blueprint is configuration only. The service cannot start its market observation worker until valid Alpaca Paper/data credentials are securely configured. It remains observation-only; no order placement route exists.


## Milestone 22: agent command centre and auditable activity

Added a dashboard command centre that polls the persisted event log every five seconds and displays each specialist role, its latest recorded status, symbol, summary, timestamp and strategy outcomes where available. The worker now writes explicit AGENT_ACTIVITY events for Chief Orchestrator, Research Agent and Small Trading Agent during each observation cycle, including start, completion, blocked and error outcomes.

The dashboard deliberately labels Risk Manager, Position Monitor and Performance Agent as standby/not yet connected to the recurring worker. Their software foundations or role scaffolds exist, but the dashboard does not pretend they are currently executing. The current agents are deterministic software roles, not independent LLM agents. All events explicitly retain execution_enabled=false. This is an audit view, not a trade control panel.

The agent command centre becomes genuinely live only after the worker is running against the shared database and the dashboard API is connected. In-memory fixtures remain test data. CI must pass after this milestone before it is considered verified.
