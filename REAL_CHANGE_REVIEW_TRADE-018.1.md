# REAL CHANGE REVIEW — TRADE-018.1

## Root cause

The UI submitted `paperTestMode` correctly, the API mapped it to `paper_test_mode`, reload mapped that same column back, and Railway consumed the same owner row. The failure was in the persistence acknowledgement: `upsertConfig` discarded the Supabase result and the API returned the submitted in-memory object as a successful save. A missing/stale TRADE-018 schema or any rejected database write therefore looked successful until navigation caused a real reload, at which point no persisted `true` existed and the normal no-value default was OFF.

## Fix

- Configuration save now performs an owner-scoped upsert followed by `select('*').single()`.
- The returned database row is hydrated and every TRADE-018 setting is compared with the submitted value.
- A database error or mismatch returns HTTP 503 with `AUTO_TRADER_CONFIG_PERSISTENCE_FAILED`; the dashboard shows the underlying safe detail rather than claiming success.
- Configuration load now returns an explicit migration/load error instead of silently hydrating defaults after a failed query.
- Boolean hydration uses an exact persisted `true`; default OFF is used only when the owner configuration row does not exist.
- Added an idempotent hotfix migration that guarantees all TRADE-018 configuration columns and owner RLS policy exist.
- Railway continues reading `auto_trader_config` by `user_id` and maps the exact same `paper_test_mode` and target columns.
- Added validation for all numeric test thresholds.

## Persistence boundary

The test-mode flag, target, Big Money settings, thresholds, and universe now reside exclusively in the owner-scoped Supabase configuration. They survive navigation, refresh, authentication cycles, and Vercel/Railway restarts. No browser, Vercel process, or Railway process memory is authoritative.

## Safety

- PAPER-only enforcement and LIVE lock are unchanged.
- Risk Manager, TradePermissionService, broker-confirmation counting, protection, idempotency, and the 8/8 bounded target remain intact.
- No broker order was placed.
- No deployment, push, merge, or LIVE enablement was performed.

## Database

Apply `supabase/migrations/202608200003_trade_018_1_paper_test_persistence_hotfix.sql` before deploying the application and worker changes.

## Verification

- Production build: passed.
- TypeScript: passed.
- ESLint: passed.
- Full test suite: 252 passed, 0 failed.
- Persistence regression suite: 7 passed, 0 failed.
- Prettier: passed.
- `git diff --check`: passed (line-ending notices only).
- Native syntax checks passed for all Railway workers.
- `npm run worker:start`, `npm run worker:notifications`, and `npm run worker:trader` remained running without ESM/module-resolution failures and were stopped manually after verification.
