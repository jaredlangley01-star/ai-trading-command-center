# REAL CHANGE REVIEW — MIGRATION STATUS HOTFIX

## Root cause

Diagnostics queried `schema_migrations` for exactly `202608140010_trade_016_final_production`. The query succeeded but returned no row, which rules out a stale client response and a ledger-query failure. The expected name exactly matches the marker in the TRADE-016 SQL file.

The production error reported during the earlier partial run occurred on the first non-idempotent policy creation. The TRADE-016 version insert is at the end of that migration, so execution stopped before the marker could be written. Later migrations use independent ledger inserts; applying TRADE-016.4 therefore did not backfill the missing TRADE-016 row.

Diagnostics also treated only that one historical row as the complete expected state. It did not require the later TRADE-016.4 marker.

## Repair

Created:

`supabase/migrations/202608160002_trade_016_migration_status_repair.sql`

The repair runs in one transaction and:

1. Uses additive/idempotent DDL to converge only the required TRADE-016 tables, column, and index if a partial run omitted anything.
2. Enables RLS and transactionally restores the exact existing owner-scoped policies. No policy is broadened.
3. Verifies all required tables and columns, the chart index, RLS enablement, policy commands, owner predicates, and policy write checks.
4. Preserves existing environment settings and inserts only missing PAPER/LIVE rows with `ON CONFLICT DO NOTHING`.
5. Verifies every owner has both environment rows.
6. Only then inserts the missing `202608140010_trade_016_final_production` marker and this repair migration's marker.

Any failed verification raises an exception and rolls back the entire transaction, including migration markers. The file contains no table drop, truncate, data delete, reset, or LIVE enablement.

## Diagnostics correction

Diagnostics now requires both:

- `202608140010_trade_016_final_production`
- `202608160001_trade_016_4_owner_workflow`

It reports the exact missing version list. It reports **Database migrations — HEALTHY** only when both required ledger rows exist, and reports the current required schema version as TRADE-016.4.

## Exact owner action

Run this complete file once in the Supabase SQL Editor:

`supabase/migrations/202608160002_trade_016_migration_status_repair.sql`

Do not manually insert a migration row. If the SQL raises `TRADE-016 repair blocked`, retain the full error and stop; the transaction will have made no committed changes.

After it succeeds, deploy the application code through the owner's normal process, sign in, and run Diagnostics again. Database migrations should report **HEALTHY** with required migrations recorded through `202608160001_trade_016_4_owner_workflow`.

## Files changed

- `app/api/diagnostics/route.ts`
- `supabase/migrations/202608160002_trade_016_migration_status_repair.sql`
- `tests/migration-status-hotfix.test.mjs`
- `REAL_CHANGE_REVIEW_MIGRATION-STATUS-HOTFIX.md`

## Safety

- Existing TRADE-016.4 tables and data are untouched.
- Existing production data is not deleted or reset.
- Owner-scoped RLS remains enabled and unchanged in scope.
- PAPER remains the active environment.
- LIVE remains locked.
- No order was placed.
- Nothing was pushed or deployed.

## Validation

- Production build: passed.
- TypeScript: passed.
- ESLint: passed.
- Prettier: passed.
- Full application tests: 164 passed, 0 failed.
- Migration-status regression tests: passed for the complete/partial repair guard and Diagnostics version-set behavior.
- `git diff --check`: passed.
