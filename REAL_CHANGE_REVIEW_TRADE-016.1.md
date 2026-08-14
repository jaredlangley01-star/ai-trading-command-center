# TRADE-016.1 — Final Production Hotfix Change Review

## Scope and safety

- PAPER trading remains the only enabled execution mode.
- LIVE trading was not enabled or changed.
- No order was placed.
- Nothing was deployed or pushed.
- No production data is deleted or reset by this change.

## Dashboard chart resize fix

### Root cause

The Lightweight Charts instance used `autoSize: true` while also receiving a
numeric `height` option, and its DOM container supplied only `min-height`.
Lightweight Charts observes that container with `ResizeObserver`. Because the
container had no definite block size, the chart's rendered child could increase
the container's intrinsic height; the observer then applied that larger size to
the chart, producing a recursive vertical growth loop.

### Resolution

- The responsive `autoSize` behavior is retained.
- The conflicting JavaScript `height` option is removed.
- The observed container now has a definite bounded height: 420px on desktop
  and tablet, 340px at the existing mobile breakpoint.
- `min-height: 0` prevents intrinsic grid/flex sizing from overriding the bound.
- No timer, manual polling resize, or disabled responsiveness is used.

The main Dashboard and dedicated Charts workspace both render the same
`ProfessionalMarketDashboard` / `TradingChart` implementation, so both receive
the fix. Chart recreation dependencies remain `data`, `mode`, and `position`;
there is no resize-derived React state. Candlesticks, volume, crosshair,
timeframes, position overlays/selectors, portfolio-equity mode, and dashboard
drag/reorder persistence are unchanged.

## Supabase migration rerun safety

Run exactly:

`supabase/migrations/202608140010_trade_016_final_production.sql`

The migration now:

- Executes inside one transaction.
- Creates tables and the chart index with `if not exists`.
- Enables RLS on every TRADE-016 owner table on every run.
- Drops and recreates only the named RLS policies, converging clean and partial
  databases on the exact owner predicates without deleting table rows.
- Uses conflict-safe seed inserts, preserving existing PAPER and LIVE settings.
- Removes a potentially premature custom diagnostic version marker inside the
  transaction and inserts it only after all required schema, RLS, policies, and
  seed rows succeed. Any failure rolls the marker change back with the schema.
- Creates no functions or triggers, so there are no TRADE-016 function/trigger
  collisions to reconcile.

Clean-run and partially-applied behavior is covered by migration regression
assertions for transaction boundaries, conflict-safe object creation and seed
data, policy replacement, exact owner scoping, and final marker ordering.

## Additional production-build correction

Metadata URL construction now treats an empty `NEXT_PUBLIC_SITE_URL` as
unconfigured and uses the existing safe invalid-domain fallback. This allows the
production-render setup state to load instead of throwing `ERR_INVALID_URL`.

## Verification

- `npm run build` — pass
- `npm run typecheck` — pass
- `npm run lint` — pass
- `npm run format:check` — pass
- `npm test` — pass, 139/139
- `git diff --check` — pass
- `npm run worker:start` — native ESM entrypoint starts and reaches the expected
  `MISSING_ENV:NEXT_PUBLIC_SUPABASE_URL` configuration gate in this credential-free
  local workspace
- `npm run worker:notifications` — native ESM entrypoint starts and reaches the
  same expected configuration gate
- TRADE-015.1 explicit ESM import regression — pass

No Supabase CLI/Postgres runtime is installed in this workspace, so the SQL was
not executed against a local database. The migration's clean and partial paths
were verified structurally and by the application regression suite; the owner
should run the file above once in the Supabase SQL Editor for production.
