# REAL CHANGE REVIEW — TRADE-015

## Outcome

TRADE-015 connects deterministic TRADE-013 intelligence to the existing production strategy, risk, permission, and Alpaca PAPER services. The hosted worker ranks every eligible symbol, records both winning and rejected candidates, applies session/cooldown/portfolio gates, claims a durable execution key, and only then invokes the existing AutoTraderEngine. Big Money remains owner-approved.

## Entries, sizing, and exits

Entry gates include enabled state, Emergency Stop, fresh production market data, allowed symbols/strategies/directions, opportunity/confidence/historical thresholds, deterministic regime suitability, session rules, cooldowns, duplicate positions, concentration, concurrent positions, total/symbol exposure, daily risk, TradePermissionService, and broker availability. Position size is bounded by stop distance, maximum planned loss, configured capital, risk limits, exposure, and buying power; AI never sizes or authorizes.

Existing stop-loss/take-profit monitoring remains outside the autonomous-entry try/catch and runs while entries are paused, locked, degraded, or rejected. Exit reason and protective failure remain persisted and notified.

## Reconciliation and recovery

Each successful hosted cycle treats Alpaca PAPER account, positions, orders, and fills as authoritative and records a reconciliation snapshot. Deterministic execution claims and Alpaca client order identifiers prevent replay after worker/network restart. A submitted request is not treated as a fill; later broker synchronization confirms actual state.

## Failure modes and audit

Market-data or broker failures block new entries. SEC, news, research, AI, and notification failures degrade independently and cannot stop existing-position protection. Candidate evaluations preserve scores, regime, portfolio context, selection, rejection reasons, sizing and downstream risk/broker outcomes so the owner can explain taken and skipped trades.

## Dashboard redesign

The Dashboard now uses actual range-limited Alpaca OHLCV with green/red candlesticks, volume, crosshair, axes, zoom, pan, timeframes, open-position selection, entry/current/stop/target overlays, and portfolio-equity mode. Batched Alpaca snapshots power a searchable watchlist. Major widgets support drag reorder and durable owner layout preferences with a mobile fallback. The boxed T brand mark was removed and typography, values, controls, states, and responsive targets were enlarged.

Display currency supports USD, ZAR, GBP and EUR through a hosted exchange-rate abstraction. Conversion is timestamped and display-only; all broker, risk, sizing, P/L, and persisted account calculations remain USD. Five trading clocks use IANA timezones and runtime daylight-saving rules.

## New configuration

Auto Trader adds risk profile, portfolio exposure, opportunity/confidence/historical thresholds, LONG/SHORT controls, IANA session window, trade cooldown and loss cooldown. Dashboard preferences store layout, display currency, and watchlist. `FX_RATE_BASE_URL` and `NEXT_PUBLIC_DASHBOARD_REFRESH_INTERVAL_MS` are optional hosted display settings.

## Known limitations

Alpaca IEX availability and exchange trading hours determine candle coverage. The exchange-rate provider publishes reference rates rather than executable FX quotes. Drag resizing is limited to responsive CSS sizing; reorder and restore-default are durable. Correlation is not fabricated: concentration uses known symbol, direction, strategy and exposure only.

No deployment, push, merge, test order, LIVE credential, or LIVE enablement was performed.
