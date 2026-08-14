# REAL CHANGE REVIEW — TRADE-009.5

## Outcome

The production broker architecture is cloud-only. Hosted preview and production runtimes select the Alpaca PAPER Trading API through the generic `BrokerService`; the application no longer defaults to an IBKR local gateway.

## Runtime policy

- Explicit modes: `LOCAL_DEVELOPMENT`, `HOSTED_PREVIEW`, `HOSTED_PRODUCTION`.
- Hosted runtimes permit only `ALPACA_PAPER` and the official paper domain.
- Localhost, loopback addresses, IBKR/TWS ports, and Gateway adapters are rejected in hosted modes.
- IBKR TWS and Client Portal implementations remain intact as explicit `LOCAL_ONLY / NOT PRODUCTION ELIGIBLE` development adapters.

## Cloud PAPER broker

- Account summary, cash, equity, buying power, positions, open orders, fills, market/limit orders, and cancellations use Alpaca's PAPER Trading API.
- Trading and market data remain separate service interfaces and credential variables.
- LIVE configuration and orders fail closed.
- Auto Trader, Big Money, manual PAPER orders, Risk Manager, Emergency Stop, and TradePermissionService retain their existing boundaries.

## Verification

- Cloud runtime, Alpaca PAPER normalization, LIVE lock, Emergency Stop, Auto Trader, Big Money, and offline-owner architecture tests: passed.
- Full application tests: 74 passed.
- Legacy IBKR bridge tests: 11 passed.
- TypeScript: passed.
- ESLint: passed.
- Production build: passed.
- Prettier: passed.
- `git diff --check`: passed.
