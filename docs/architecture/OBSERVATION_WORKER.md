# Observation worker

Run the observation-only worker with Python 3.12+ after installing the project. Configure server-side environment variables:

- APCA_API_KEY_ID and APCA_API_SECRET_KEY: Alpaca Paper/data credentials (never commit them)
- SMALL_TRADING_SYMBOLS: comma-separated symbols; defaults to AAPL,MSFT,NVDA
- SMALL_TRADING_SCAN_INTERVAL_SECONDS: minimum 5 seconds; defaults to 60
- SMALL_TRADING_DATABASE_PATH: SQLite file path; defaults to data/trading.db

Construct the worker with build_worker_from_environment() and call run_forever() from a supervised process. For a one-cycle diagnostic, call run_once().

This worker runs market observation and strategy evaluation only. It writes OBSERVATION_CYCLE, OBSERVATION_ERROR and HEARTBEAT events to SQLite. It has no execution gateway, no broker order methods, and no live trading path. Its output is not a trade instruction and its strategy signals have no demonstrated profitability.

The worker is not deployed. A durable hosted deployment still needs a provider that supports persistent processes and persistent disk, secret configuration, HTTPS/authenticated dashboard proxy, process restart policy, monitoring and cost approval. Do not use a sleeping free web service for unattended trading.
