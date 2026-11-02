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


## Read-only dashboard API process

The API is a separate process from the observation worker:

\`\`\`bash
small-trading-api
\`\`\`

Environment variables:

- \`SMALL_TRADING_API_HOST\`: defaults to \`127.0.0.1\`. Non-loopback binding requires \`SMALL_TRADING_API_TOKEN\`.
- \`SMALL_TRADING_API_PORT\`: defaults to \`8765\`.
- \`SMALL_TRADING_API_TOKEN\`: bearer token shared with the Next.js server-side proxy.
- \`APCA_API_KEY_ID\` and \`APCA_API_SECRET_KEY\`: optional Alpaca Paper account credentials. If absent, the broker endpoint reports NOT_CONNECTED. If present, the account reader makes GET-only requests to the fixed Alpaca Paper API host.

The API exposes only read-only status, health, portfolio and broker endpoints. It has no order submission, amendment, cancellation or position-close route. The Next.js server proxy requires \`SMALL_TRADING_BACKEND_URL\` and \`SMALL_TRADING_API_TOKEN\`; keep both server-side and never use a \`NEXT_PUBLIC_\` prefix.

The API process and observation worker are separate services and must share the same durable SQLite database path if the dashboard is expected to display worker heartbeats. The current API uses a local simulator portfolio snapshot for its legacy portfolio endpoint; the broker panel uses broker-reported account, positions and recent orders and does not substitute simulator values.
