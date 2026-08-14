# REAL CHANGE REVIEW — TRADE-006

## Mission summary

Replaced the placeholder PAPER risk checks with a deterministic, configurable Production Risk Manager. Every supported paper-order path now produces a structured risk decision before broker submission, records the decision, and preserves the independent Emergency Stop and LIVE lock.

## Decision engine

The engine returns one of:

- `APPROVED`
- `REJECTED`
- `REDUCE_SIZE`
- `DAILY_LOCK`
- `SYSTEM_LOCK`

Every decision includes a machine-readable reason, requested capital, approved capital, and calculated stop-loss exposure. Rules cover maximum capital and loss per trade, daily loss and profit boundaries, daily trade count, concurrent positions, portfolio and per-asset exposure, drawdown, Auto Trader allocation, and Big Money score approval.

## Daily and system safety

- Daily loss, daily profit, and trade-count boundaries lock new Auto Trader openings for the trading date.
- Manual PAPER decisions remain independently risk-checked; daily Auto Trader locks do not close or stop management of existing positions.
- Daily locks survive reloads in owner-scoped Supabase state and display `AUTO TRADER LOCKED FOR TODAY`.
- Emergency Stop and maximum drawdown produce system locks.
- A missing or invalid stop-loss produces `INSUFFICIENT_RISK_CAPACITY`.
- LIVE mode remains rejected before any broker request.

## Order safety

- Paper orders are reserved by their unique client order ID before broker access, preventing concurrent reconnect retries from duplicating an order.
- The flow is risk evaluation → TradePermissionService → generic PAPER broker.
- Rejected or reduced orders never reach the broker.
- Accepted paper submissions increment the owner’s daily trade counter atomically.
- Risk and broker failures cannot bypass the permission layer.

## Persistence and RLS

- Added `daily_risk_state` for per-owner, per-date profit/loss, trade count, and lock state.
- Added immutable `risk_decisions` records containing the decision and non-secret calculation context.
- Risk settings remain in the existing owner-scoped `risk_settings` table.
- All new records use Row Level Security with `auth.uid()` ownership checks.
- No broker credentials, session material, or service-role values are stored client-side.

## Dashboard

- Added a responsive Risk Manager settings workspace for all eleven requested limits.
- Settings changes are authenticated, validated server-side, persisted to Supabase, and audited.
- Added daily lock messaging clarifying that existing PAPER positions remain managed.
- The paper ticket now requires a stop-loss so maximum-loss capacity can be calculated.

## Main files

- `src/services/risk-manager.ts`
- `src/services/broker/paper-order-service.ts`
- `src/services/market-data-engine.ts`
- `app/api/broker/orders/route.ts`
- `app/api/risk/settings/route.ts`
- `components/trading-command-center.tsx`
- `supabase/migrations/202608130005_trade_006_production_risk.sql`
- `tests/risk-manager.test.mjs`

## Owner action

Apply `supabase/migrations/202608130005_trade_006_production_risk.sql` after the TRADE-005 migration, then restart the application.

## Verification results

- Production build: passed.
- TypeScript: passed.
- ESLint: passed.
- Tests: passed (35/35).
- Prettier: passed.
- `git diff --check`: passed.

## Safety confirmation

**PAPER remains the only trading mode. LIVE execution remains hard locked.**

**No deployment, push, merge, live-account connection, or real-money transaction was performed.**
