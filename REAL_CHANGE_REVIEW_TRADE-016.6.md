# REAL CHANGE REVIEW — TRADE-016.6

## Root cause

`app/api/broker/orders/route.ts` compared `Date.now()` with `paper_market_quotes.as_of` and rejected every quote older than 120 seconds. Railway stores Alpaca IEX's actual `latestTrade.t` (falling back to the minute-bar timestamp), not the worker synchronization time. The check had no Alpaca clock or exchange-calendar context, so a legitimate last regular-session trade became `SYNC_FAILED: Railway Alpaca IEX quote is stale` after the close, overnight, on weekends, and on market holidays.

The previous thresholds were:

- Manual queue admission: hard-coded 120,000 ms.
- General market-data service: `MARKET_DATA_MAX_AGE_MS`, default 30,000 ms.
- No pre-market, after-hours, weekend, holiday, or closed-session distinction existed in manual queue admission.

## Corrected freshness architecture

Railway now reads Alpaca PAPER `/v2/clock` and the current-day `/v2/calendar` every cycle. It persists the provider clock observation, trading-day evidence, next open/close, and normalized session alongside the genuine IEX quote timestamp.

The shared policy classifies `REGULAR`, `PRE_MARKET`, `AFTER_HOURS`, and `CLOSED`:

- `REGULAR`: strict freshness, default 120 seconds.
- Supported extended quote display: default five-minute freshness.
- `CLOSED`: preserves and labels the last regular quote without calling it current or stale.
- Weekends/holidays: `CLOSED`, using calendar evidence rather than fabricated data.

Vercel validates before queueing and Railway validates again immediately before broker submission. No old quote is used to estimate a fill; Alpaca remains fill authority.

## Manual PAPER order behavior

- MARKET + regular/current quote: may proceed through Risk Manager, TradePermissionService, durable queue, Railway revalidation, and Alpaca PAPER.
- MARKET + regular/stale quote: `STALE_DATA`.
- MARKET + closed market: `MARKET_CLOSED`.
- MARKET + pre-market/after-hours: `ORDER_NOT_AVAILABLE_IN_CURRENT_SESSION` because this mission does not enable an extended-hours order type.
- LIMIT: retains the owner's explicit limit price and existing risk/permission checks. It is never automatically converted from MARKET and never derives a fill from the last quote.

Paper Trading now polls owner-scoped session data and displays market state, real quote age, last-session price, and next open when available.

## Auto Trader root cause and state flow

The platform intentionally defaults and production migrations initialize Auto Trader as `PAUSED`; it must not become active after deployment automatically. There were also two gating fields (`system_state.auto_trader_status` and `auto_trader_config.enabled`) that could disagree after a partial update or older deployment.

`system_state.auto_trader_status` is now the authoritative persisted state. Resume/Enable authenticates the owner, verifies PAPER mode, Emergency Stop, Risk Manager state, and valid configuration, then atomically attempts to persist `ACTIVE` and synchronize the configuration flag. Railway reads the authoritative state every cycle and reports `SCHEDULED`/`PAUSED` in its durable heartbeat. UI and Diagnostics read the same state; the UI additionally shows Railway acknowledgement.

`ACTIVE` with zero positions is shown as `SCANNING / WAITING FOR SETUP · ACTIVE TRADES: 0`. PAUSED blocks new autonomous entries while the independent protective-position pass continues.

## Files changed

- `src/services/market-data/session-freshness.ts`
- `app/api/broker/orders/route.ts`
- `hosted-worker/index.mjs`
- `src/services/paper-execution.ts`
- `src/services/broker/errors.ts`
- `app/api/auto-trader/route.ts`
- `components/trading-command-center.tsx`
- `src/services/diagnostics.ts`
- `.env.example`
- `app/globals.css`
- `supabase/migrations/202608170001_trade_016_6_session_freshness.sql`
- `tests/trade-016-6-session-auto-state.test.mjs`

## Environment variables

- `PAPER_REGULAR_QUOTE_MAX_AGE_MS=120000` (optional; strict regular-session threshold)
- `PAPER_EXTENDED_QUOTE_MAX_AGE_MS=300000` (optional; extended-session display threshold)

No credentials moved to Vercel. No LIVE configuration changed.

## Owner deployment steps

1. Apply `supabase/migrations/202608170001_trade_016_6_session_freshness.sql` after TRADE-016.5.
2. Optionally add the two freshness variables to both Vercel and the Railway trading worker; the documented safe defaults apply if omitted.
3. Deploy the reviewed commit to Vercel and the Railway trading worker. Do not change either Railway start command.
4. Wait for one successful worker cycle, then confirm Paper Trading reports `MARKET OPEN`, an extended session, or `MARKET CLOSED` rather than `SYNC_FAILED` for a valid last-session quote.
5. In Auto Trader, review configuration and deliberately select Resume. Confirm `ACTIVE`, Railway acknowledgement, and `SCANNING / WAITING FOR SETUP` when active positions are zero.
6. Keep LIVE locked and do not submit an automated validation order.

## Tests

Coverage includes fresh/stale regular quotes, closed last-session quotes, pre-market, after-hours, weekends, provider-calendar holidays, MARKET blocking reasons, no fake quote/fill generation, persisted ACTIVE/PAUSED behavior, worker restart behavior, UI/worker acknowledgement, zero-position scanning state, independent position protection, LIVE lock, and Railway ESM imports.
