# Single-service Render deployment option

Status: configuration committed for review; nothing has been deployed and no service has been created.

## Why this option exists

The local Docker Compose bundle runs the worker and API as separate containers sharing one SQLite volume. Render persistent disks are attached to one service instance and cannot be mounted by a second service. Therefore, do not deploy that two-container Compose arrangement to Render as-is.

For a low-cost first hosted version, `render.yaml` defines one paid Render web service. The `small-trading-app` process runs the observation worker and read-only dashboard API together in one container, on one host, using one persistent disk and one SQLite database. This avoids cross-service SQLite sharing.

## Proposed configuration

- One Render Docker web service using the Starter/0.5 CPU, 512 MB plan.
- One 1 GB persistent disk mounted at `/data`.
- SQLite database at `/data/trading.db`.
- API binds to Render's `PORT` on `0.0.0.0`.
- Render generates `SMALL_TRADING_API_TOKEN`; it is not committed to Git.
- Alpaca credentials are prompted as secrets and must be entered in Render's secure environment settings, never in chat or source control.
- Market data feed is explicitly IEX.
- The app starts the worker and the GET-only dashboard API in one process supervisor and handles SIGINT/SIGTERM shutdown.
- The API remains read-only. This runtime does not create any order placement, amendment, cancellation or close route.
- The service is single-instance because the SQLite file and attached disk are local to that service.

The existing Next.js dashboard can remain separately hosted. Its server-side `SMALL_TRADING_BACKEND_URL` must point to the Render HTTPS service URL, and its server-side `SMALL_TRADING_API_TOKEN` must match the Render-generated token. Never expose this token through a `NEXT_PUBLIC_` variable.

## Estimated minimum cost

Render currently lists the smallest paid web service at US$7/month and persistent disks at US$0.25 per GB-month. A 1 GB disk therefore puts this proposed backend at approximately **US$7.25/month**, before tax, bandwidth overages or currency conversion. Pricing can change; verify the checkout total before approving anything.

The free web-service tier is not suitable for an always-on market worker. Render disks are not available to free services, and Render documents that disks are accessible only to the single service instance to which they are attached.

## Limitations and safeguards

- This is a PAPER observation service only. It reads Alpaca IEX bars and account/market-clock information; it cannot submit broker orders.
- No account credentials have been supplied or configured.
- A successful deploy or health check does not prove market-data quality, strategy profitability, broker reconciliation or uninterrupted uptime.
- SQLite on one persistent disk is appropriate only for this initial single-instance build. Before multiple workers, multiple app instances or higher availability, migrate the event store to a managed database and add concurrency/recovery controls.
- Do not add a second service that tries to read the same SQLite file from a separate Render disk.
- Do not activate this Blueprint without explicit user approval of the recurring cost.

## Official references

- Render pricing: https://render.com/pricing
- Render persistent disk limitations: https://render.com/docs/disks
- Render Blueprint reference: https://render.com/docs/blueprint-spec
- Render web service plans: https://render.com/docs/compute-plans
