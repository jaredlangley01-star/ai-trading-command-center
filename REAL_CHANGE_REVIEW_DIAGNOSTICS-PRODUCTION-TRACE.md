# REAL CHANGE REVIEW — DIAGNOSTICS MIGRATION PRODUCTION TRACE

## Root cause

The Diagnostics route authenticated the owner and then used the same cookie-backed Supabase SSR client for every query. That client is created with `NEXT_PUBLIC_SUPABASE_ANON_KEY`; after authentication it operates as the authenticated PostgREST role. It was not a service-role/server administration client.

`public.schema_migrations` is global deployment metadata with no `user_id`. A successful SQL Editor query runs with elevated database privileges and does not prove that the authenticated PostgREST role can see the table. If production has RLS or grants that hide this table, PostgREST can return an empty successful result. The old route treated that empty result as proof that both rows were absent. It also reduced query errors to a generic database error, so the response did not provide enough evidence to distinguish permissions, an empty result, or the wrong Supabase project.

Repository migrations do **not** enable RLS on `schema_migrations`, so RLS does not apply in the repository-defined clean schema. The production database may have permission/RLS drift not represented by the repository. Regardless, the previous authenticated client was subject to production PostgREST grants and to RLS if production enabled it.

## Complete request path after this fix

1. The browser prevents concurrent clicks, enters `RUNNING…`, and sends an authenticated, no-store request.
2. The API verifies the owner session using the cookie-backed authenticated anon client.
3. Owner-scoped worker, risk, and position queries continue using that authenticated client and their existing RLS.
4. Only the global migration-ledger read uses a server-only Supabase service-role client when `SUPABASE_SERVICE_ROLE_KEY` is configured. The key is never returned to or bundled for the browser.
5. The route reads all `version` values and compares the returned strings exactly, without normalization.
6. Query errors render `Migration check failed...`; they are never translated into missing rows.
7. A successful empty result remains `DEGRADED` with the two exact missing versions.
8. The owner-only JSON response includes safe `diagnosticTrace.migrations` evidence.

## Safe production trace metadata

The response now reports:

- whether the migration query succeeded;
- `SERVER_SERVICE_ROLE` or `AUTHENTICATED_ANON` client selection;
- returned row count;
- exact returned version strings;
- exact expected version strings;
- configured Supabase hostname and project reference;
- safe error code/message when the query fails.

No key, token, cookie, credential, broker configuration, or secret value is returned.

## Changed files

- `app/api/diagnostics/route.ts`
- `components/trade-016-workspaces.tsx`
- `src/lib/supabase/config.ts`
- `src/lib/supabase/server.ts`
- `src/services/diagnostics.ts`
- `tests/diagnostics-production-trace.test.mjs`
- `tests/diagnostics-migration-fix.test.mjs`
- `tests/diagnostics-hotfix.test.mjs`
- `tests/migration-status-hotfix.test.mjs`
- `REAL_CHANGE_REVIEW_DIAGNOSTICS-MIGRATION-FIX.md`
- `REAL_CHANGE_REVIEW_DIAGNOSTICS-PRODUCTION-TRACE.md`

The first false-negative hotfix changes were already uncommitted in the working tree and were preserved.

## Owner deployment instructions

No SQL must be run. Do not create another migration and do not modify `schema_migrations`.

1. In the Vercel production project, confirm `NEXT_PUBLIC_SUPABASE_URL` identifies the same production project shown in Supabase SQL Editor.
2. Configure `SUPABASE_SERVICE_ROLE_KEY` as a **server-only Vercel Production environment variable** using the service-role key belonging to that exact Supabase project. Never prefix it with `NEXT_PUBLIC_`.
3. Deploy these application changes through the normal owner-controlled process.
4. Sign in, run Diagnostics, and inspect the `/api/diagnostics` JSON response in the browser Network panel.
5. Confirm `diagnosticTrace.migrations.client` is `SERVER_SERVICE_ROLE`, the hostname/project reference is the intended production project, `querySucceeded` is `true`, and `returnedVersions` contains both required strings.

If `client` reports `AUTHENTICATED_ANON`, the Vercel server variable is absent from that deployment environment. If the hostname/reference is unexpected, correct `NEXT_PUBLIC_SUPABASE_URL` and ensure its anon and service-role keys come from that same project. If `querySucceeded` is false, use the safe error code/detail shown in the trace; Diagnostics will display a failed check rather than claiming the rows are missing.

## Regression coverage

- Required rows returned: healthy migration comparison.
- Required row genuinely absent: degraded with exact missing row.
- Permission/RLS failure: explicit failed check, never missing rows.
- Successful empty result: degraded with both missing rows.
- Unavailable Supabase configuration: HTTP/check failure.
- Exact strings: no trimming or case normalization.
- Trace metadata includes project/client/query evidence and contains no client-side service-role reference.
- Existing diagnostics, PAPER, LIVE lock, worker, broker, risk, and position-protection tests remain green.

## Validation

- Production build: passed.
- TypeScript: passed.
- ESLint: passed.
- Prettier: passed.
- Full application tests: 174 passed, 0 failed.
- `git diff --check`: passed.

## Safety

- No SQL migration was created or run.
- No database state, schema, RLS policy, or migration row was changed.
- Trading behavior, broker behavior, risk controls, workers, PAPER readiness, and position protection were not changed.
- LIVE remains locked.
- No order was placed.
- Nothing was pushed or deployed.
