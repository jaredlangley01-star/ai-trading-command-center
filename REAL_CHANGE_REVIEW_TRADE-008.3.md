# REAL CHANGE REVIEW — TRADE-008.3

## Outcome

The bridge now correlates subscription errors with the market-data mode of the exact ticker request. A failed live snapshot is cleared and cancelled, delayed market-data type `3` is selected, and a fresh ticker ID waits for delayed bid, ask, and last callbacks.

## Regression fixed

- Error `10089` remains terminal for the original type-`1` real-time request and triggers fallback.
- A repeated `10089` associated with the fresh type-`3` request is treated as a subscription warning while the bridge waits for official delayed tick IDs 66–76.
- Successful delayed callbacks are normalized as `IBKR_TWS_PAPER_DELAYED` with `isDelayed: true`; the original error is not propagated.
- Explicit delayed-unavailable errors and delayed timeouts return `DELAYED_MARKET_DATA_UNAVAILABLE`.

## Safety review

- No order execution, cancellation, risk, permission, or confirmation logic changed.
- PAPER remains the only accepted environment.
- LIVE ports remain hard locked.
- No credentials or authentication data were added.

## Verification

- Exact `10089` to delayed-callback regression: passed.
- Bridge tests: 11 passed.
- Bridge Python syntax compilation: passed.
- Application tests: 54 passed.
- TypeScript: passed.
- ESLint: passed.
- Production build: passed.
- Prettier: passed.
- `git diff --check`: passed.
