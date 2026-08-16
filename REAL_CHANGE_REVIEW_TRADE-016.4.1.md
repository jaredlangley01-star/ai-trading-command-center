# REAL CHANGE REVIEW — TRADE-016.4.1

## Outcome

Railway can now launch the Trading Worker and Notification Worker as separate persistent services from the same repository without changing either worker implementation.

- Trading Worker continues to use `/railway.json` and `npm run worker:start`.
- Notification Worker uses `/railway.notifications.json` and `npm run worker:notifications`.
- Both files retain the existing Railpack builder and restart policy.
- No credentials, environment values, broker/risk/order behavior, or LIVE configuration changed.

## Root cause

The duplicated Notification Worker inherited the repository-default `/railway.json`. That file explicitly sets `deploy.startCommand` to `npm run worker:start`. Railway Config-as-Code takes precedence over dashboard values, so the Custom Start Command correctly appeared locked and the duplicated service launched the trading entry point.

## Configuration architecture

Railway supports selecting a custom Config-as-Code file for each service. The existing Trading Worker remains on the repository default file, while the Notification Worker selects the notification-specific file. The service-level config-file path is therefore the selector; each selected file owns the correct persistent start command.

This is safer than removing or replacing the working Trading Worker command globally:

- Existing Trading Worker deployments remain unchanged.
- Notification deployments cannot accidentally invoke the trading entry point once their config path is selected.
- Commands and restart behavior remain reviewable in Git.
- No shell dispatcher or environment-controlled process switching is introduced.

## Exact Railway owner changes after deployment

### Trading Worker

1. Open the existing **Trading Worker** service.
2. Open **Settings**.
3. In the Config-as-Code section, keep the config file path as `/railway.json` (or leave it at the repository default).
4. Confirm the resolved Start Command shows `npm run worker:start`.
5. Do not change its existing variables.

### Notification Worker

1. Open the duplicated **Notification Worker** service.
2. Open **Settings**.
3. In the Config-as-Code section, set the config file path to `/railway.notifications.json`.
4. Save/stage that service setting.
5. Confirm the resolved Start Command now shows `npm run worker:notifications`. It may remain locked because its value is intentionally supplied by the selected file.
6. Do not change or copy Alpaca credentials into this service. Retain only its existing notification-worker variables, including Supabase, hosted runtime, and VAPID values.
7. Review the Railway staged changes and redeploy only the Notification Worker when ready.

After startup, its logs should be from `hosted-worker/notification-worker.mjs`, and Diagnostics should begin reading its persisted notification heartbeat. The service does not need a public domain.

## Files changed

- `railway.notifications.json`
- `tests/trade-016-4-1-railway-workers.test.mjs`
- `REAL_CHANGE_REVIEW_TRADE-016.4.1.md`

## Safety

- PAPER remains the active trading environment.
- LIVE remains locked.
- No order path was invoked.
- The working Trading Worker config and command were not changed.
- No push or deployment was performed.

## Validation

- Production build: passed.
- TypeScript: passed.
- ESLint: passed.
- Prettier: passed.
- Full application tests: 162 passed, 0 failed.
- `git diff --check`: passed.
- `node --check` passed for both worker entry files.
- `npm run worker:start` loaded the trading entry point and remained persistent against a localhost-only empty validation service until intentionally stopped.
- `npm run worker:notifications` independently loaded the notification entry point and remained persistent against the same empty validation service until intentionally stopped.
- The validation service returned zero owners, so no Alpaca request, PAPER order, LIVE order, notification delivery, or durable data mutation was possible.
- Running both commands without Railway variables also reached their deliberate `MISSING_ENV:NEXT_PUBLIC_SUPABASE_URL` configuration gates with no module/import errors.
