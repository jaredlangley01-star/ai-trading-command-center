# REAL CHANGE REVIEW — TRADE-008.2

## Outcome

The local PAPER bridge now prefers real-time IBKR quotes and retries subscription failures with the official delayed market-data mode. Delayed responses preserve bid, ask, last, timestamp, and source metadata and are explicitly marked `isDelayed: true` through the bridge and dashboard.

## Safety review

- The fixed PAPER connection boundary remains `127.0.0.1:4002`, client ID `41`.
- LIVE ports and non-PAPER environments remain rejected before any broker operation.
- No order placement, cancellation, confirmation, risk, or permission logic was changed.
- The bridge restores the session preference to real-time market data after every quote attempt.
- Missing delayed data fails closed as `DELAYED_MARKET_DATA_UNAVAILABLE`; it is never presented as real-time or delayed quote data.
- No credentials or broker authentication data were added.

## Market-data behavior

- Real-time request: TWS market data type `1`, `isDelayed: false`, source `IBKR_TWS_PAPER_REALTIME`.
- Subscription fallback: TWS market data type `3`, `isDelayed: true`, source `IBKR_TWS_PAPER_DELAYED`.
- Dashboard delayed label: `IBKR PAPER — DELAYED`.
- Delayed IBKR tick IDs for bid, ask, last, and close remain normalized to the existing quote contract.

## Verification

- Bridge tests: 10 passed.
- Bridge Python syntax compilation: passed.
- Application tests: 54 passed.
- TypeScript: passed.
- ESLint: passed.
- Production build: passed.
- Prettier: passed.
- `git diff --check`: passed.
