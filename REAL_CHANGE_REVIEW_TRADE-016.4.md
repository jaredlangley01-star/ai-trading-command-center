# REAL CHANGE REVIEW — TRADE-016.4

## Outcome

TRADE-016.4 completes the owner guidance, active PAPER trade visibility, Portfolio, Trade Journal, Strategies, manual request lifecycle, and notification-worker health integration without redesigning the TRADE-016.3 interface. LIVE remains locked. No broker order was placed, and nothing was pushed or deployed.

## Root causes corrected

- Portfolio, Strategies, and Trade Journal routes still rendered placeholder or disconnected UI instead of the hosted Alpaca PAPER/Supabase lifecycle.
- Dashboard position and recent-activity fallbacks could display local sample state when no synchronized PAPER activity existed.
- A manual Paper Trading client request ID remained attached to later intentional submissions. Duplicate protection was correct, but the client lifecycle did not distinguish a retry from a new submission.
- Alpaca reconciliation persisted broker position values but did not durably retain reliable Big Money/Auto Trader/manual origin, risk-decision linkage, or a closed-trade journal lifecycle.
- The notification worker validated VAPID before it could publish health. A missing VAPID configuration therefore looked simply offline and provided no actionable persisted state.
- Hosted broker labels and the worker variable contract did not consistently reflect the deployed Alpaca PAPER service.

## Tutorial behavior

- Added an owner-scoped, first-use guided tutorial with immediate close/skip, back/next, completion, replay, and reset.
- The walkthrough highlights the existing Dashboard, Active Trades, win/loss display, Auto Trader, Big Money, Portfolio, Strategies, Paper Trading, Trade Journal, Risk Manager, Notifications, Diagnostics, and LIVE lock.
- Buying Power, Open Exposure, Unrealized/Realized P/L, Stop Loss, Take Profit, and Risk/Reward definitions exist only inside the temporary tutorial.
- Settings now contains Auto Show, Replay, and Reset controls. Completion/dismissal and auto-launch are persisted per authenticated owner.

## Active Trades and Dashboard

- A compact global summary now shows active count, reliable BIG/SMALL/STANDARD counts, capital in market, and open P/L across authenticated pages.
- BIG is only an approved Big Money origin. SMALL is only Auto Trader. Unknown, external, and manual origins fall back to STANDARD; the UI never guesses.
- Dashboard prominently derives WINNING/LOSING/FLAT, open P/L dollars, and open P/L percentage from synchronized PAPER state.
- Dashboard open positions expose symbol, direction, quantity, entry/current values, P/L, classification, and status, with a Portfolio link and a real empty state.
- Recent Activity uses persisted fills/audit events and has no sample trade fallback.

## Portfolio data sources

- Alpaca PAPER reconciliation is authoritative for account, open positions, broker orders, and fills.
- Supabase supplies durable strategy/origin/risk metadata, account history, completed journal entries, and owner activity.
- Portfolio presents equity, cash, buying power, exposure, open count, unrealized and realized P/L; contained tables show positions, open orders, and recent fills.
- Position detail shows synchronized entry/current values, position economics, stop/target, origin, strategy, risk decision, safe broker reference, opened timestamp, and owner-scoped lifecycle guidance.
- When synchronization is absent, the UI shows `NO SYNC DATA`; it does not manufacture positions.

## Journal lifecycle and strategy performance

- The hosted worker detects a real Alpaca PAPER position close, correlates an opposite-side broker fill, and idempotently creates one completed-trade record for that position lifecycle.
- Journal fields include timestamps, entry/exit, gross/cost/net P/L, return, duration, stop/target, entry/exit reason, risk linkage, strategy, origin/classification, and PAPER environment.
- Filters support date, symbol, classification, strategy, win/loss, origin, and exit reason. Summary aggregates completed trades, wins/losses, win rate, realized P/L, average and largest wins/losses.
- Strategy performance aggregates those same journal rows. The Strategies workspace shows actual configured eligibility, current limits, regime guidance, persisted signals, completed trades, realized performance, backtest drawdown where present, and a Backtesting link.
- Automated decision strategy and risk identifiers are carried into synchronized positions and completed trades. Broker client-order ID correlation is exact; origin is not inferred from symbol alone.

## Manual duplicate-order fix

Each new manual form submission receives a cryptographically unique client request ID. Simultaneous clicks are synchronously blocked. A completed HTTP response rotates the ID for the next intentional order, including a safe rejection; a network failure retains the same ID so retry remains idempotent. Server-side duplicate reservation and broker client-order protection remain unchanged.

## Notification worker

- The Railway worker now starts and publishes owner-scoped heartbeat metadata even when VAPID is missing.
- Missing VAPID is reported as `NOT CONFIGURED`, not a silent crash; queued events fail safely and never block trading or protective exits.
- With VAPID configured, queue processing, preferences, cooldown/deduplication, persisted heartbeat, subscription delivery, and Safe Test Notification use the existing Supabase event pipeline.
- Diagnostics interprets the persisted notification-worker metadata without requiring Railway secrets in Vercel.
- The hosted trading worker accepts established `ALPACA_PAPER_*` broker variables and legacy `ALPACA_BROKER_*` aliases, but permits only `https://paper-api.alpaca.markets`, `BROKER_ADAPTER=ALPACA_PAPER`, hosted production runtime, and IEX.

## Exact files changed

- `app/api/dashboard/route.ts`
- `app/api/diagnostics/route.ts`
- `app/api/journal/route.ts`
- `app/api/portfolio/route.ts`
- `app/api/strategy/performance/route.ts`
- `app/api/tutorial/route.ts`
- `app/globals.css`
- `components/guided-tutorial.tsx`
- `components/notification-workspace.tsx`
- `components/paper-workflow-workspaces.tsx`
- `components/trading-command-center.tsx`
- `hosted-worker/index.mjs`
- `hosted-worker/notification-worker.mjs`
- `src/services/paper-workflow.ts`
- `supabase/migrations/202608160001_trade_016_4_owner_workflow.sql`
- `tests/market-data-engine.test.mjs`
- `tests/premium-ui.test.mjs`
- `tests/trade-016-4-owner-workflow.test.mjs`
- `OWNER_SETUP_TRADE-016.4.md`
- `REAL_CHANGE_REVIEW_TRADE-016.4.md`

## Automated validation

- Production build: passed.
- TypeScript (`npm run typecheck`): passed.
- ESLint (`npm run lint`): passed.
- Prettier (`npm run format:check`): passed.
- Full application tests: 160 passed, 0 failed.
- TRADE-015.1 explicit ESM graph tests: passed for both workers.
- `npm run worker:start`: reached its deliberate local `MISSING_ENV:NEXT_PUBLIC_SUPABASE_URL` safety gate; there was no ESM/module-resolution failure.
- `npm run worker:notifications`: reached the same deliberate local environment safety gate; there was no ESM/module-resolution failure.
- `git diff --check`: passed.

## Browser verification

The authenticated command-center component was rendered through a temporary local visual harness because no authenticated Supabase session or production secrets are present in this workspace. The harness was removed before final build and validation.

- 1920×1080 desktop: no horizontal page overflow or top-header overlap; Active Trades and open P/L were visible; chart remained 430px after repeated measurement.
- 1440×900 laptop: Portfolio, Strategies, Trade Journal, Notifications, and Settings rendered without page overflow. Portfolio tables remained contained; strategy config/backtest linkage, journal filters, tutorial controls, and Safe Test controls were present.
- 1366×768 compact laptop: no overflow; global Active Trades remained visible; chart remained 430px and did not expand.
- 768×1024 tablet: no page overflow; Big Money tables scrolled inside their 486px containers rather than widening the page.
- 390×844 mobile: sidebar/mobile navigation reflow was correct, no page overflow, Active Trades remained visible, and chart remained 340px after repeated measurement. Backtesting, Paper Trading, and Risk Manager retained readable 14px body type without overflow.
- Tutorial welcome rendered with visible Close and Skip controls; Skip immediately removed the overlay and returned control to Dashboard.
- No sample recommendation or sample position/activity appeared. Empty states reported zero/no synchronized PAPER activity.

## Known limitations

- This work does not deploy the migration or restart Railway. The owner must perform the steps in `OWNER_SETUP_TRADE-016.4.md`.
- No real PAPER order was submitted during implementation. Lifecycle coverage uses mock broker projections and existing service/route regression tests, as required.
- Browser push delivery requires a subscribed device, permission granted by that browser, and valid Railway VAPID configuration.
