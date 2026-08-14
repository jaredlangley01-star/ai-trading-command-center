# REAL CHANGE REVIEW — TRADE-014

## Outcome

TRADE-014 adds an installable hosted PWA, Web Push subscriptions, owner preferences, a notification center, a durable Supabase queue, and a dedicated Railway notification worker. Push can operate while the dashboard and owner PC are off, subject to the device/browser’s Web Push support.

## Architecture

Railway trading/research events are written to `notification_events`. A separately hosted Railway notification worker applies owner preferences, score thresholds, quiet hours, cooldowns, and durable deduplication before encrypted VAPID delivery. Keeping the processor separate lets it detect stale trading-engine heartbeats and issue outage/recovery alerts even if the trading worker is unavailable.

Subscriptions contain only Web Push endpoint/public encryption material. The VAPID private key remains a Railway environment secret. Expired subscriptions are disabled after provider status 404/410. Failed push delivery is contained and cannot interrupt portfolio synchronization, protective exits, risk checks, or other trading-worker duties.

## Owner experience

Settings provides guided PWA/push enrollment, device removal, safe testing, global controls, quiet hours, cooldown, opportunity threshold, and independent event toggles. Critical alert categories require explicit acknowledgement before disabling. The notification center includes unread count, category/severity filtering, delivery status, deep links, individual read state, and mark-all-read.

## Safety

Notification modules have no broker, order, cancellation, recommendation approval, position mutation, risk-setting, Auto Trader, Emergency Stop, or LIVE control. Deep links open authenticated dashboard workspaces and never encode an approval or execution action. Push payloads remove credential-like fields. LIVE remains hard locked and no local/IBKR/TWS dependency was introduced.

## Verification

Tests cover subscriptions, removal, preferences, critical acknowledgement, quiet hours, thresholds, cooldown/deduplication, restart recovery, notification-center behavior, deep links, secret redaction, unsupported browsers, provider failure, trading/protective-exit independence, broker isolation, hosted operation, owner RLS, LIVE lock, and absence of local dependencies.

No deployment, push, merge, broker order, or LIVE enablement was performed.
