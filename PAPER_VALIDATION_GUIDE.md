# PAPER Validation Guide

Successful PAPER testing does not predict or guarantee profitable LIVE performance.

## Daily routine

1. Run **Diagnostics** and record the result.
2. Confirm both Railway heartbeats, database, Alpaca data/broker, Risk Manager, and Position Protection.
3. Review Auto Trader decisions and rejection reasons.
4. Reconcile positions, risk status, journal, fills, and notifications.

## Trading validation

- Submit a confirmed manual PAPER market order and limit order.
- Generate a Big Money recommendation; test view, modify, reject, approve, expiry, stale-price rejection, and risk rejection.
- Test Auto Trader LONG and SHORT eligibility independently.
- Test multiple positions, stop-loss, take-profit, order rejection, and close reasons.
- Confirm every order says PAPER and is visible in Alpaca PAPER.

## Risk validation

Test maximum trade size, planned loss, concurrent positions, asset/portfolio exposure, daily loss, daily profit target, and Emergency Stop. Confirm daily locks block new entries but do not abandon existing position protection. Reset must leave Auto Trader paused.

## Reliability validation

- Restart each Railway worker separately and verify heartbeat recovery without duplicate orders/fills/exits.
- Redeploy Vercel and confirm the workers continue without the browser.
- Close the browser and power off the PC for a planned interval; verify Railway activity and phone push delivery.
- Where safe, temporarily revoke a non-trading provider credential and confirm a degraded diagnostic, safe recovery, and no risk bypass.

## Reconciliation

Compare Alpaca PAPER against the dashboard for equity, cash, buying power, positions, open orders, filled orders, quantities, entry prices, and fills. Record every difference before further testing.

## Backtesting and charts

- Run multiple symbols, strategies, timeframes, and historical ranges. Confirm backtests never execute orders.
- Test chart symbols and all supported timeframes, zoom/pan/crosshair, drawings, indicator settings, overlays, watchlist changes, refresh, logout/login, and another device.

## Test log

| Date/time | Area           | Test                     | Expected                                  | Actual | PASS/FAIL | Evidence/notes |
| --------- | -------------- | ------------------------ | ----------------------------------------- | ------ | --------- | -------------- |
|           | Diagnostics    | Both workers current     | ONLINE                                    |        |           |                |
|           | Trading        | PAPER order confirmation | Confirmed PAPER only                      |        |           |                |
|           | Risk           | Emergency Stop           | New entries blocked; protection continues |        |           |                |
|           | Reconciliation | Alpaca vs dashboard      | Exact match or explained latency          |        |           |                |

Stop validation and keep Auto Trader paused after any unexplained broker mismatch, duplicate action, missing protection, stale worker heartbeat, or safety-gate failure.
