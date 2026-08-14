# REAL CHANGE REVIEW — TRADE-010

## Outcome

The repository is prepared for a fully hosted PAPER deployment: native Next.js on Vercel, a persistent Node worker on Railway, owner-authenticated Supabase persistence, Alpaca IEX market data, and Alpaca PAPER brokerage. Deployment cannot be completed from this environment because GitHub, Vercel, and Railway authorization is not available.

## Production architecture

- Vercel serves the protected Trading Command Center through `next build`.
- Railway runs `hosted-worker/index.mjs` independently of any browser or owner computer.
- The worker reads Alpaca IEX snapshots and PAPER account/position/order state, persists owner-scoped heartbeat/run records, and continuously reports health.
- Supabase service-role access exists only in the Railway process. The browser receives no broker or service-role secrets.
- IBKR, TWS, localhost bridges, PowerShell, and local files are absent from the hosted runtime path.

## Reliability and safety

- Hosted startup rejects every broker except `ALPACA_PAPER`, rejects non-PAPER environments, rejects any brokerage URL other than `https://paper-api.alpaca.markets`, and restricts market data to IEX.
- LIVE remains hard locked in the broker factory, permission path, worker startup, and dashboard.
- The migration pauses existing Auto Trader configurations for the first hosted deployment.
- Worker run idempotency keys are unique per worker/owner/minute. A restart or overlapping cycle cannot create a second durable run for that interval.
- The worker never places a startup/test order. Existing order paths still require Risk Manager, TradePermissionService, emergency-stop clearance, and explicit PAPER confirmation.
- Heartbeats older than 90 seconds display as OFFLINE.

## Files

- `hosted-worker/index.mjs`: Railway persistent worker and startup safety gates.
- `railway.json`: Railway build/start/restart policy.
- `vercel.json`: native Next.js Vercel build.
- `supabase/migrations/202608140004_trade_010_hosted_worker.sql`: RLS-protected heartbeat/run persistence and first-deploy pause.
- `OWNER_SETUP_TRADE-010.md`: owner-only deployment and secret placement steps.

## Validation boundary

Local checks validate compilation, formatting, tests, static hosted safety, and both build paths. End-to-end Supabase/Alpaca/Vercel/Railway validation requires the owner to complete the authorization and secret-entry steps in `OWNER_SETUP_TRADE-010.md`.
