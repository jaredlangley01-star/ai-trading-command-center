# IBKR Local PAPER Bridge

Windows-compatible loopback HTTP bridge built on the official Interactive Brokers Python TWS API. It normalizes the asynchronous TWS socket callbacks for the Trading Command Center and contains hard PAPER-only guards at both the HTTP and order layers.

## Fixed safety boundary

- HTTP listener: `127.0.0.1:8765` only
- IB Gateway: `127.0.0.1:4002` only
- Client ID: `41`
- Environment: `PAPER` only
- Live ports `4001` and `7496`, TWS port `7497`, non-loopback hosts, other client IDs, non-PAPER environments, unconfirmed orders, and unsupported order types are rejected before an IBKR call.
- No username, password, token, cookie, account number, or other authentication material is accepted or stored.

IB Gateway owns authentication. The owner signs in to the PAPER session directly in IB Gateway.

## Endpoints

All POST bodies must include:

```json
{
  "environment": "PAPER",
  "host": "127.0.0.1",
  "port": 4002,
  "clientId": 41
}
```

- `GET /health`
- `POST /v1/account/summary`
- `POST /v1/account/positions`
- `POST /v1/account/orders`
- `POST /v1/account/executions`
- `POST /v1/market/quote`
- `POST /v1/market/history`
- `POST /v1/orders`
- `POST /v1/orders/:id/cancel`

Supported orders are confirmed PAPER market and limit BUY/SELL orders only. The bridge preserves the application `clientOrderId` as the IBKR order reference.

## Implementation

- `bridge.py` — fixed production entry point and lifecycle
- `safety.py` — fail-closed environment, host, port, client-ID, and order guards
- `http_server.py` — standard-library loopback HTTP server and normalized errors
- `ibkr_client.py` — official `EWrapper`/`EClient` implementation, callback correlation, timeouts, reconnection, and response normalization
- `start-bridge.ps1` — owner startup command
- `tests/test_bridge.py` — guard, routing, failure-handling, and source-contract tests

The bridge starts even when IB Gateway is temporarily unavailable. Data/order endpoints return a normalized `503` and retry the PAPER connection on later requests. Authentication-required, pacing, timeout, rejection, and disconnected states are returned without crashing the HTTP process.

Quote requests prefer real-time market data. When IBKR reports that the PAPER account lacks an API market-data subscription, the bridge requests official TWS delayed market data type `3`. Delayed quotes return `isDelayed: true` and source `IBKR_TWS_PAPER_DELAYED`; unavailable delayed data returns a normalized error and is never mislabeled as real-time.

The live and delayed snapshots use separate ticker IDs. The failed live snapshot is cancelled and removed before retry. If Gateway repeats subscription warning `10089` for the delayed ticker while transitioning to delayed tick IDs 66–76, the bridge keeps that delayed request open; explicit delayed-unavailable errors or a delayed timeout still fail closed.

## Start

Complete [OWNER_SETUP_TRADE-008.1.md](../OWNER_SETUP_TRADE-008.1.md), then run from PowerShell:

```powershell
.\ibkr-bridge\start-bridge.ps1
```

Stop with `Ctrl+C`.

## Test

The safety tests do not require IB Gateway or `ibapi`:

```powershell
py -m unittest discover -s .\ibkr-bridge\tests -v
```

Syntax-check the official-client module without connecting:

```powershell
py -m py_compile .\ibkr-bridge\bridge.py .\ibkr-bridge\http_server.py .\ibkr-bridge\ibkr_client.py .\ibkr-bridge\safety.py
```
