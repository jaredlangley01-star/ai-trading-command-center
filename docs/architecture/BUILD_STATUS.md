# Build Status — Milestone 2

Status: source scaffold committed; not deployed or broker-connected.

Implemented: typed market/proposal/decision models; research freshness gate; four transparent strategy evaluators; deterministic PAPER-only risk gate; shared specialist agent roles and orchestrator; initial risk tests.

Not yet implemented: live market-data adapter; historical-bar storage; broker account reconciliation or PAPER order execution; position lifecycle worker; persistent database; scheduler; dashboard; deployment; runtime monitoring.

The strategy evaluators are basic baseline formulas, not evidence of profitability. The risk gate rejects proposals exceeding limits rather than silently resizing them. This scaffold cannot place orders.

Local setup requires Python 3.12+ and pytest. Install the project with the test extra, then run pytest from the repository root. No credentials or paid services are needed for these unit tests.
