import test from "node:test";
import assert from "node:assert/strict";
import {
  TradePermissionService,
  requestTradingMode,
} from "../src/services/trade-permission.ts";
const settings = {
  autoTraderEnabled: true,
  autoTraderAllocatedCapital: 25000,
  maximumCapitalPerTrade: 2500,
  maximumRiskPerTrade: 250,
  dailyMaximumLoss: 750,
  dailyProfitTarget: 1000,
  maximumTradesPerDay: 8,
  maximumConcurrentPositions: 4,
  maximumPortfolioDrawdown: 12,
  maximumExposurePerAsset: 20,
  bigMoneyApprovalThreshold: 85,
};
const state = (x = {}) => ({
  mode: "PAPER",
  autoTraderStatus: "ACTIVE",
  riskState: "NORMAL",
  emergencyStopActive: false,
  ...x,
});
test("application starts and remains in PAPER mode", () => {
  assert.equal(requestTradingMode("PAPER").mode, "PAPER");
  assert.equal(requestTradingMode("LIVE").mode, "PAPER");
});
test("LIVE mode explains the safety gate", () =>
  assert.match(requestTradingMode("LIVE").error, /Safety Gate/));
test("emergency stop locks trading and approvals", () => {
  const p = new TradePermissionService(
    state({
      emergencyStopActive: true,
      autoTraderStatus: "LOCKED",
      riskState: "LOCKED",
    }),
    settings,
  );
  assert.equal(p.canTradeAutomatically(), false);
  assert.equal(p.canApproveRecommendation(), false);
});
test("active paper mode permits automation; paused does not", () => {
  assert.equal(
    new TradePermissionService(state(), settings).canTradeAutomatically(),
    true,
  );
  assert.equal(
    new TradePermissionService(
      state({ autoTraderStatus: "PAUSED" }),
      settings,
    ).canTradeAutomatically(),
    false,
  );
});
test("permission service has no order execution method", () => {
  const p = new TradePermissionService(state(), settings);
  assert.equal("executeOrder" in p, false);
  assert.equal("submitOrder" in p, false);
});
