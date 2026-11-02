# Small Trading Platform — Foundation

## Product scope

Build a new, hosted-first Small Trading platform. The first release is PAPER-only and focuses on US-listed stocks/ETFs. Big Money is out of scope for the first release, but the architecture should allow it to be added later without duplicating shared services.

The dashboard is a control surface, not the trading engine. The trading engine must continue operating when the user's computer is off.

## Non-negotiable safety rules

- PAPER mode only. No live broker adapter, live endpoint, or live credentials in the first release.
- The execution gateway is the only component permitted to submit, amend, or cancel broker orders.
- Every order must pass deterministic risk checks immediately before submission.
- Missing, stale, contradictory, or unavailable market/account data means no new trade.
- Enforce idempotency and per-symbol/per-position locks to prevent duplicate orders.
- All decisions, rejections, order events, risk decisions, and agent runs must be auditable.
- Intraday positions must be closed before the configured session cutoff; no overnight positions.
- Emergency stop must block new entries and initiate the configured safe position-management procedure.
- No paid service or usage-based API may be enabled without explicit owner approval.

## Initial technology direction

- Python 3.12+ application with typed, modular services.
- A persistent hosted worker/scheduler runs trading cycles independently of the dashboard.
- SQLite for the first single-instance deployment; define repository interfaces so PostgreSQL can replace it later.
- Broker adapter interface, initially implemented only for Alpaca Paper.
- Alpaca Paper-only account and IEX data feed for the first integration. IEX coverage limitations must be displayed and respected.
- Lightweight responsive web dashboard, separated from the worker.
- Hosting target: a verified always-free VM where available. Deployment must remain portable to another Linux VM.

## Agent roles (one shared instance per role, not one per ticker/trade)

1. Chief/Orchestrator: schedules cycles, assigns work, handles timeouts and health.
2. Research: obtains market data, validates freshness and produces market snapshots/candidates.
3. Small Trading: evaluates configured strategies and proposes entry/stop/target/size.
4. Position Monitor: checks open orders and positions, stop/target/exit rules and session cutoff.
5. Risk Manager: deterministic code, not an LLM decision; validates every order and can reduce/reject/lock.
6. Performance & Reporting: reconciles broker records, computes results and produces audit summaries.

Agents are logical specialist modules. They may process multiple symbols or positions concurrently through task records and locks. Do not create a separate agent process for every symbol.

## Trading workflow

1. Scheduler starts a cycle only when the market session and system state permit it.
2. Research retrieves quotes/bars and records source, timestamp and freshness.
3. Strategy modules evaluate Trend Following, Momentum, Breakout and Mean Reversion.
4. Small Trading ranks valid opportunities and creates an order proposal.
5. Risk Manager validates capital, position size, per-trade loss, daily loss, exposure, concurrent positions, data quality and session rules.
6. Execution Gateway re-checks PAPER mode, permissions, idempotency and emergency stop, then submits through the Alpaca Paper adapter.
7. Position Monitor reconciles broker state and manages exits.
8. Performance & Reporting records every outcome and reason.

## Initial validation gates

- Unit tests for strategies, sizing, risk rules, session cutoffs and duplicate prevention.
- Integration tests against a paper/sandbox adapter.
- Reconciliation tests for partial fills, rejected orders, timeouts and reconnects.
- Prove that stale data, missing stop-loss, missing account state, worker heartbeat loss and emergency stop all prevent new entries.
- Run in observation mode before enabling automatic PAPER order submission.
- No live trading capability is part of this release.

## Deployment principles

- Store secrets only in the host's secret/environment configuration; never commit credentials.
- Separate web dashboard from worker process.
- Worker health is based on fresh heartbeats and completed cycles, not a manually toggled status.
- Add a hard monthly cost guard: only free resources may be configured until explicitly approved.
- Keep deployment provider-agnostic and document recovery/backup steps.

## Existing repository reuse policy

The current codebase is retained as a reference. Strategy formulas and risk rules may be ported after review and tests. Do not directly reactivate the existing hosted worker or carry forward its Supabase dependencies, conflicting settings, or unverified runtime assumptions.
