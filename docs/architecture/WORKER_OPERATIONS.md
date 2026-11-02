# Running the observation-only worker

Install Python 3.12+ and the project:

```bash
python -m pip install -e .
```

Configure these environment variables in the process environment or hosting secret manager:

- `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY`: Alpaca credentials for read-only IEX market data.
- `SMALL_TRADING_SYMBOLS`: comma-separated US stock symbols; defaults to `AAPL,MSFT,NVDA`.
- `SMALL_TRADING_SCAN_INTERVAL_SECONDS`: scan interval, minimum 5 seconds; defaults to 60.
- `SMALL_TRADING_DATABASE_PATH`: persistent SQLite file path; defaults to `data/trading.db`.

Run one diagnostic scan:

```bash
small-trading-worker --once
```

Run the recurring worker:

```bash
small-trading-worker
```

The process handles SIGINT and SIGTERM, stops between symbols, and closes its SQLite connection cleanly. Use a process supervisor or container restart policy to restart it after a crash. The application itself does not install a supervisor.

This is an observation-only service. It retrieves market bars and records strategy evaluations and heartbeats. It has no execution gateway and cannot place, amend, or cancel orders. A clean one-shot run verifies connectivity and data parsing, not strategy profitability or broker account readiness.

For hosting, use a persistent process and durable disk. Configure credentials as server-side secrets. Do not use a sleeping free web service for unattended operation. No cloud resources are created by this repository change.
