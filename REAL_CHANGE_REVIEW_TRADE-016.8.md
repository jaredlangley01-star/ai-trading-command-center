# REAL CHANGE REVIEW — TRADE-016.8

## Outcome

Implemented provider-backed market status presentation and shared Alpaca asset discovery without changing strategy, Auto Trader, risk, broker, order-routing, or permission logic.

## Market awareness

- New York uses the authenticated Alpaca PAPER clock as the authoritative regular-session signal and distinguishes `REGULAR`, `PRE-MARKET`, `AFTER-HOURS`, `OVERNIGHT`, and `CLOSED`.
- Regular is green, extended sessions are amber, and closed is red. Text labels remain visible so meaning never depends on color alone.
- London, Johannesburg, Tokyo, and Sydney remain timezone clocks and explicitly show `LOCAL MARKET TIME · STATUS UNKNOWN`; their clocks do not claim tradability.
- TRADE-016.6 quote freshness and session order guards remain unchanged.

## Asset discovery

- Added authenticated `/api/assets`, backed by Alpaca `/v2/assets`, `/v2/clock`, most-active, and movers endpoints.
- Provider metadata supplies symbol, name, asset class, exchange, tradability, shortability, fractionability, and overnight attributes where available.
- Exchange-to-region display mapping is deterministic and never guesses from ticker text.
- The shared searchable selector is used by Charts, the professional dashboard chart, and the PAPER order ticket.
- Contextual owner help defines symbol, stock, ETF, index, exchange, and region.

## Top 5 Market Focus

- Ranking is deterministic and limited to tradable symbols with actual most-active or mover evidence.
- Reasons identify the provider evidence used. No opportunity or market claim is fabricated.
- If screener evidence is unavailable, the UI shows `TOP 5 TEMPORARILY UNAVAILABLE` and retains provider assets as the fallback.
- Refresh cadence is three minutes and does not create aggressive browser polling.
- The list is discovery-only and is not connected to Auto Trader selection or execution.

## Safety review

- PAPER remains the only enabled execution environment.
- LIVE remains hard locked.
- Asset discovery has no broker, order, risk, or permission imports.
- Existing order freshness/session enforcement remains authoritative.
- No migration, credentials, deployment, push, broker order, or local dependency was added.

## Files

- `src/services/market-data/asset-discovery.ts`
- `app/api/assets/route.ts`
- `components/asset-discovery-select.tsx`
- `components/professional-market-dashboard.tsx`
- `components/trade-016-workspaces.tsx`
- `components/trading-command-center.tsx`
- `app/globals.css`
- `tests/trade-016-8-market-discovery.test.mjs`

## Owner setup

No new owner setup or environment variables are required. The feature uses the existing server-only Alpaca PAPER/data credentials.

## Verification

- Production build: passed.
- TypeScript: passed.
- ESLint: passed.
- Prettier: passed.
- Full tests: 214/214 passed.
- `git diff --check`: passed.
- Railway trading worker native ESM startup: passed (remained alive until the bounded smoke-test timeout).
- Railway notification worker native ESM startup: passed (remained alive until the bounded smoke-test timeout).
- Automated responsive/status/discovery regression coverage: passed.
- Manual desktop/laptop/tablet/mobile browser inspection could not be completed because the in-app browser connection was unavailable during validation.
