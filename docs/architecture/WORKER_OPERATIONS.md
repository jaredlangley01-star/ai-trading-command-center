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


## Container commands

The same image can run either process. Start the observation worker with the default command:

    docker run --restart unless-stopped --env-file .env --mount type=volume,src=small-trading-data,dst=/data small-trading-worker:local

Start the read-only API as a separate container using the same durable volume and shared API token:

    docker run --restart unless-stopped --env-file .env --mount type=volume,src=small-trading-data,dst=/data small-trading-worker:local small-trading-api

The .env file is an operator-managed local example only; do not commit it or upload it to source control. On a hosted platform, use its encrypted environment/secret settings instead. The API should be reachable by the Next.js server proxy over a private network or authenticated HTTPS endpoint. Do not expose the Python API directly to the public internet without TLS termination and the bearer-token guard.


## Two-service deployment bundle

A Compose configuration is provided for a single Docker host:

    cp .env.small-trading.example .env.small-trading
    # Edit .env.small-trading locally and enter the Alpaca Paper credentials
    # and a newly generated random API token.
    docker compose -f docker-compose.small-trading.yml up -d --build

The worker and API share one named durable Docker volume at /data. For the local-device setup, the API port is published only on 127.0.0.1:8765, so it is not exposed to other devices or the public internet. The Next.js server-side proxy must be placed on the same private network and use the API service address (http://dashboard-api:8765) with the same SMALL_TRADING_API_TOKEN. If the frontend is hosted separately, a private network or authenticated HTTPS reverse proxy is still required; do not expose the API port directly.

The example environment file contains placeholders only. The real .env.small-trading is ignored by Git. Generate the API token locally and do not reuse the Alpaca key. Compose validation in CI checks configuration syntax, not successful broker connectivity, persistent-volume behavior on a particular host, TLS, network reachability, uptime, or market-data quality.

This is a deployment recipe, not a deployed service. No cloud host, DNS, domain, paid plan, or broker account is provisioned by the repository.


## Run the dashboard and observation worker on one macOS device

This is the preferred no-hosting-cost development setup when the computer can stay switched on. It runs the Python observation worker and read-only API in Docker, while the Next.js dashboard runs locally on the same device. The API port is published only on 127.0.0.1, not the device's network interface.

Prerequisites: Docker Desktop, Git, Node.js 22.13+, and an Alpaca Paper account with market-data credentials. This setup does not send orders.

1. Clone the development branch:

       git clone --branch rebuild/small-trading-foundation https://github.com/jaredlangley01-star/ai-trading-command-center.git
       cd ai-trading-command-center

2. Create the private worker environment file:

       cp .env.small-trading.example .env.small-trading
       openssl rand -hex 32

   Put the generated random value into `SMALL_TRADING_API_TOKEN` in `.env.small-trading`. Add your Alpaca Paper API key and secret there. Keep this file private; it is ignored by Git. Never paste credentials into chat or commit them.

3. Start the worker and API:

       docker compose -f docker-compose.small-trading.yml up -d --build

   Check that both containers are running:

       docker compose -f docker-compose.small-trading.yml ps
       docker compose -f docker-compose.small-trading.yml logs -f observation-worker

4. Create the local dashboard environment file `.env.local` in the project root with these two entries. Use the exact same token as the worker file:

       SMALL_TRADING_BACKEND_URL=http://127.0.0.1:8765
       SMALL_TRADING_API_TOKEN=PASTE_THE_SAME_RANDOM_TOKEN_HERE

   `.env.local` is ignored by Git. It must not use a `NEXT_PUBLIC_` prefix.

5. In a second Terminal window, install and start the dashboard:

       npm ci
       npm run dev

6. Open http://localhost:3000/small-trading in the browser. The Agent Command Centre and activity timeline will show only the events actually written by the running worker.

Keep Docker Desktop and the dashboard process running. The worker and API containers restart automatically if they exit, but the dashboard dev server must remain running while you use the web interface. Closing the laptop, losing internet, or stopping Docker pauses market observation. This is a development setup, not a hardened public production service.

To stop the worker and API:

       docker compose -f docker-compose.small-trading.yml down

The SQLite data volume is retained when containers are stopped this way. Do not use `down --volumes` unless you intend to erase the local trading event database.


## Guided Mac startup (recommended for the first local run)

After cloning this branch, you can use the guided startup script instead of manually creating the two environment files:

    bash scripts/start-small-trading-mac.sh

The script checks Docker Desktop and Node.js, securely prompts in the terminal for missing Alpaca Paper credentials (the secret input is hidden), generates a random dashboard API token, writes private local environment files with owner-only permissions, starts the worker/API containers, installs dashboard dependencies if needed, and launches the local dashboard. Credentials are never sent to this chat or printed by the script. The script does not create an Alpaca account and cannot proceed until the user has obtained Paper credentials from Alpaca.

To stop the dashboard API and worker containers while preserving the local database volume:

    bash scripts/stop-small-trading-mac.sh

Pressing Control+C in the dashboard terminal stops only the Next.js development server; the Docker worker keeps running until the stop script is used. This local setup requires the Mac, Docker Desktop and internet connection to remain on.
