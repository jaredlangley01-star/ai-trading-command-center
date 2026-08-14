# REAL CHANGE REVIEW — DIAGNOSTICS HOTFIX

## Outcome

`Diagnostics → RUN SYSTEM CHECK` now starts visibly, performs a fresh authenticated same-origin request, prevents concurrent duplicate runs, renders fresh results, and updates `LAST CHECKED`. HTTP, authentication, network, incomplete-response, and server failures are visible with a safe message, failed check, HTTP status where available, and timestamp.

This remains a read-only, non-trading operation. No trading, strategy, risk, broker execution, Supabase mutation, worker execution, PAPER/LIVE, or safety-gate behavior was changed. LIVE remains locked.

## Root cause

The production flow had two coupled defects:

1. The Vercel diagnostics route determined Alpaca PAPER and IEX readiness from broker environment variables in the Vercel process. Those secrets correctly live on Railway, so an otherwise healthy Railway configuration was reported as not configured from Vercel.
2. The route did not inspect Supabase query errors before reporting database health, while the client converted every non-2xx, invalid JSON, and network failure into one generic message with no HTTP status, failed subsystem, or timestamp. This made a failed or partial request appear as though the button had not run.

The client also relied only on asynchronous React state to disable repeated clicks. Two clicks in the same render window could start concurrent checks.

## Changes

### Diagnostics API

- Preserves authenticated owner lookup and owner-scoped Supabase queries.
- Reads current Trading Worker and Notification Worker heartbeats.
- Derives Railway runtime, Alpaca PAPER, Alpaca IEX, account health, and LIVE-lock status from persisted heartbeat metadata. Railway credentials are not required or exposed on Vercel.
- Uses Vercel environment readiness only as a local fallback, not as a requirement for Railway-owned secrets.
- Checks every Supabase query result and emits subsystem-specific safe failures.
- Returns structured error payloads for missing authentication, missing Supabase server configuration, and unexpected route failures.
- Always returns `generatedAt`, `expectedMigration`, `liveLocked`, and non-trading status fields, including failure responses.
- Continues checking `202608140010_trade_016_final_production` in `schema_migrations`.
- Never invokes broker, trading, order, worker, or mutation APIs.

### Diagnostics UI

- Explicitly sends the authenticated same-origin session credentials.
- Shows `RUNNING…` while the request is active.
- Uses a synchronous in-flight guard in addition to the disabled button.
- Accepts and renders structured failed-check results even for non-2xx responses.
- Shows HTTP status/API detail, safe network errors, failure timestamp, and `LAST CHECKED`.
- Keeps missing LIVE credentials visibly reported as `LIVE NOT CONFIGURED — LOCKED`.

## Files changed

- `app/api/diagnostics/route.ts`
- `components/trade-016-workspaces.tsx`
- `src/services/diagnostics.ts`
- `app/globals.css`
- `tests/diagnostics-hotfix.test.mjs`
- `REAL_CHANGE_REVIEW_DIAGNOSTICS-HOTFIX.md`

Existing uncommitted TRADE-016.3 files were preserved and not reverted.

## Regression coverage

- Successful diagnostics request/payload handling
- Failed HTTP/API request visibility and timestamp
- Repeated-click/in-flight protection
- Fresh, stale, and non-ONLINE worker heartbeat detection
- Alpaca PAPER and IEX readiness from Railway heartbeat metadata without Vercel broker secrets
- Hosted Railway runtime and LIVE-lock heartbeat signals
- Missing LIVE credentials remain not configured and locked
- TRADE-016.1 migration/version detection remains tied to the final transaction marker
- Existing diagnostics non-trading and secret-redaction checks

## Browser verification

A temporary local Diagnostics-only route was used and removed before final validation.

- Initial check reached `GET /api/diagnostics`.
- The local environment has no authenticated production owner session, so the real route correctly returned HTTP 401.
- The UI rendered the failed `Authentication` check, `HTTP 401`, safe session-expired message, and failure timestamp.
- Clicking `RUN SYSTEM CHECK` again produced a newer `LAST CHECKED` timestamp, proving the click handler and fresh request completed.
- PAPER remained not ready and LIVE rendered `LIVE NOT CONFIGURED — LOCKED`.
- No production URL or authenticated production browser session is stored in this workspace, so no production request was made. The authenticated success path uses the real owner-scoped route and is covered by the heartbeat/readiness regression suite rather than demo status data.

## Validation

- Production build: PASS
- TypeScript: PASS
- ESLint: PASS
- Prettier: PASS
- Full tests: PASS — 148/148
- `git diff --check`: PASS
- Browser failure-path/click/timestamp check: PASS

The production build emitted the existing Node `module.register()` deprecation warning and completed successfully.

## Safety confirmation

- No secrets were added to Vercel or any `NEXT_PUBLIC_*` variable.
- No secrets are included in API or UI messages.
- No Supabase data was changed.
- No order was placed.
- LIVE was not enabled.
- Nothing was pushed or deployed.
