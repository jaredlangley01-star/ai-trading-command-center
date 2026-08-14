# Production Architecture

```text
Owner Web/PWA (Vercel)
  ├─ authenticated read/control APIs
  ├─ charts, diagnostics, journal, approvals, settings
  └─ no broker or database secrets
             │
             ▼
Supabase Auth + owner-scoped RLS + durable state/audit/queues
             ▲                         ▲
             │                         │
Railway Trading Worker          Railway Notification Worker
  Market Data → Strategy          Queue → Policy → Web Push
  → Risk Manager                 (never broker-authoritative)
  → TradePermissionService
  → BrokerService
  → Alpaca PAPER
```

## Boundaries

- Vercel serves the authenticated UI and non-secret server APIs. It does not run persistent trading loops.
- The Railway trading worker scans, researches, backtests, reconciles, protects positions, applies risk/permission gates, communicates with Alpaca, and writes heartbeats.
- The Railway notification worker delivers owner-scoped Web Push events and reports its heartbeat. Push failure cannot interrupt trading or protection.
- Supabase owns authentication, durable owner-scoped state, RLS, audits, queues, chart preferences/drawings, and schema-version evidence.
- Alpaca IEX market data and Alpaca brokerage remain separate service responsibilities.

## Environment model

PAPER uses only `ALPACA_PAPER_*` and `https://paper-api.alpaca.markets`. LIVE uses only `ALPACA_LIVE_*` and `https://api.alpaca.markets`. Legacy `ALPACA_BROKER_*` PAPER aliases remain temporarily accepted so the deployed TRADE-015 worker is not broken; they are never used for LIVE.

LIVE activation requires distinct credentials, canonical endpoint, server enablement flag, healthy services/diagnostics, safe order transition, strict LIVE risk settings, and typed owner confirmation. TRADE-016 leaves the server flag false.

## Recovery

Durable claims and idempotency keys prevent restart duplication. Workers resume heartbeat, reconciliation, queued jobs, position monitoring, and notification delivery after restart. Broker/provider outages fail closed; Risk Manager remains authoritative. The browser and owner PC are not required.

## Charts and diagnostics

Charts use Alpaca historical data with no fabricated candles. Drawings are persisted by owner, symbol, and timeframe. Diagnostics perform reads/configuration checks only and redact secrets; they cannot trade or mutate safety state.

## Known limitations

- LIVE is intentionally locked and unvalidated with real funds.
- Chart marks are persisted structured annotations; exact pointer placement depends on browser chart interaction support.
- Provider availability and data entitlements can degrade individual diagnostics.
- Migrations are owner-applied and never executed from the browser.
