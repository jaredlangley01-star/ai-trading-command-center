# REAL CHANGE REVIEW — TRADE-018.2

## Verified production evidence

A read-only query against the configured production Supabase project found exactly one `auto_trader_config` row for the owner. It showed:

- `enabled = true`
- `paper_test_mode = false`
- `paper_test_target_auto_positions = 8`
- the row had not been updated by the attempted Save

No identifier or secret was recorded in this report.

## Actual root cause

The TRADE-018 flag name, owner key, table, UI hydration, and Railway mapping were consistent. The Save was rejected before reaching Supabase because PostgreSQL `time` columns hydrate through PostgREST as `HH:MM:SS`, while `validConfig` accepted only `HH:MM`. The browser time control visually rendered values such as `09:35:00` as 09:35, hiding the mismatch. Toggling test mode changed local React state, but Save failed validation and no database update occurred. Reload then correctly returned the still-false production value.

TRADE-018.1 improved database-error handling, but it did not address this pre-write validation failure.

## Fix

- Normalize all persisted session times from `HH:MM:SS` to `HH:MM` during API hydration.
- Apply the same normalization in the Railway worker configuration mapper.
- Save now independently rereads `auto_trader_config` after the write and requires the reloaded flag to equal the submitted flag.
- Save requires exactly one owner row and reports an explicit error for zero/multiple rows.
- Safe persistence metadata distinguishes submitted, persisted, reloaded, and last worker-observed values without exposing owner IDs or secrets.
- Railway heartbeat metadata now reports the worker-observed test flag and target.
- Auto Trader pause/resume now uses an owner-scoped `UPDATE` rather than a partial UPSERT, preventing a missing-row reconstruction from applying defaults.
- Trader chat test-mode writes now read back and verify `paper_test_mode`.

## Persistence trace

The authoritative chain is now:

`React config.paperTestMode` → `paper_test_mode` → owner-primary-key row → independent GET/read-back → React hydration → Railway owner-row mapper → heartbeat trace.

`user_id` remains the primary key, so multiple configuration rows for one owner are structurally impossible; runtime Save nevertheless checks the count.

## Safety

- PAPER-only enforcement and LIVE lock remain unchanged.
- Risk Manager, TradePermissionService, idempotency, protection, real Alpaca confirmation, 8/8 targeting, and Big Money settings remain intact.
- Production Supabase was inspected read-only. The flag was not mutated because enabling it could authorize autonomous PAPER order attempts.
- No order, deployment, push, merge, or LIVE enablement was performed.

## Verification

- Read-only production Supabase row/uniqueness inspection: completed.
- Production build: passed.
- TypeScript: passed.
- ESLint: passed.
- Full test suite: 259 passed, 0 failed.
- TRADE-018.2 persistence regressions: 7 passed, 0 failed.
- Prettier: passed.
- `git diff --check`: passed (line-ending notices only).
- Native syntax checks passed for all Railway workers.
- `npm run worker:start`, `npm run worker:notifications`, and `npm run worker:trader` remained running without ESM/module-resolution failures and were stopped manually after verification.
