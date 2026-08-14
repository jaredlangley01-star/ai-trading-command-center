import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AlpacaPaperBrokerService } from "../src/services/broker/alpaca-paper-broker-service.ts";
import { createPaperBroker } from "../src/services/broker/factory.ts";
import { PaperOrderService } from "../src/services/broker/paper-order-service.ts";
import { TradePermissionService } from "../src/services/trade-permission.ts";
import { defaultRiskSettings } from "../src/config/trading.ts";

const config = {
  environment: "PAPER",
  baseUrl: "https://paper-api.alpaca.markets",
  apiKey: "paper-key",
  apiSecret: "paper-secret",
  timeoutMs: 100,
};

test("Alpaca PAPER normalizes account, positions, orders, fills and cancellation", async () => {
  const calls = [];
  const broker = new AlpacaPaperBrokerService(
    config,
    async (url, init = {}) => {
      calls.push({
        url: String(url),
        method: init.method ?? "GET",
        headers: init.headers,
      });
      if (String(url).endsWith("/v2/account"))
        return Response.json({
          account_number: "PA12345678",
          equity: "101000",
          portfolio_value: "100500",
          cash: "50000",
          buying_power: "200000",
          currency: "USD",
        });
      if (String(url).endsWith("/v2/positions"))
        return Response.json([
          {
            asset_id: "a1",
            symbol: "AAPL",
            side: "long",
            avg_entry_price: "100",
            current_price: "105",
            market_value: "1050",
            unrealized_pl: "50",
          },
        ]);
      if (String(url).includes("/activities/FILL"))
        return Response.json([
          {
            id: "f1",
            order_id: "o1",
            symbol: "AAPL",
            qty: "10",
            price: "105",
            transaction_time: "2026-08-14T10:00:00Z",
          },
        ]);
      if (String(url).includes("/v2/orders?"))
        return Response.json([
          {
            id: "o1",
            symbol: "AAPL",
            side: "buy",
            qty: "10",
            type: "limit",
            status: "new",
            submitted_at: "2026-08-14T09:59:00Z",
          },
        ]);
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      if (String(url).endsWith("/v2/orders") && init.method === "POST")
        return Response.json({ id: "o2", status: "accepted" });
      throw new Error(`Unexpected request ${url}`);
    },
  );
  const [account, positions, orders, fills] = await Promise.all([
    broker.getAccountSummary(),
    broker.getPositions(),
    broker.getOrders(),
    broker.getExecutions(),
  ]);
  assert.equal(account.accountIdMasked, "****5678");
  assert.equal(account.buyingPower, 200000);
  assert.equal(positions[0].profitLoss, 50);
  assert.equal(orders[0].type, "LIMIT");
  assert.equal(fills[0].price, 105);
  const placed = await broker.submitPaperOrder({
    symbol: "AAPL",
    direction: "BUY",
    quantity: 1,
    type: "MARKET",
    mode: "PAPER",
    confirmed: true,
    clientOrderId: "paper-1",
  });
  assert.equal(placed.status, "ACCEPTED");
  assert.equal((await broker.cancelPaperOrder("o2")).status, "CANCELLED");
  assert.ok(
    calls.every((call) =>
      call.url.startsWith("https://paper-api.alpaca.markets"),
    ),
  );
  assert.equal(calls[0].headers["APCA-API-KEY-ID"], "paper-key");
});

test("Alpaca adapter hard-locks LIVE domains and orders", async () => {
  assert.throws(
    () => new AlpacaPaperBrokerService({ ...config, environment: "LIVE" }),
    (error) => error.code === "LIVE_TRADING_LOCKED",
  );
  const broker = new AlpacaPaperBrokerService(config, async () => {
    throw new Error("must not call");
  });
  await assert.rejects(
    broker.submitPaperOrder({
      symbol: "AAPL",
      direction: "BUY",
      quantity: 1,
      type: "MARKET",
      mode: "LIVE",
      confirmed: true,
    }),
    (error) => error.code === "LIVE_TRADING_LOCKED",
  );
});

test("hosted production rejects every local IBKR broker configuration", () => {
  const previous = { ...process.env };
  try {
    process.env.TRADING_RUNTIME_MODE = "HOSTED_PRODUCTION";
    process.env.BROKER_ADAPTER = "IBKR_TWS_LOCAL";
    process.env.IBKR_TWS_BRIDGE_URL = "http://127.0.0.1:8765";
    assert.throws(() => createPaperBroker(), /Hosted runtimes permit only/);
    process.env.BROKER_ADAPTER = "IBKR_CLIENT_PORTAL_LOCAL";
    process.env.IBKR_GATEWAY_URL = "https://localhost:5000/v1/api";
    assert.throws(() => createPaperBroker(), /Hosted runtimes permit only/);
    process.env.BROKER_ADAPTER = "ALPACA_PAPER";
    process.env.ALPACA_BROKER_ENVIRONMENT = "PAPER";
    process.env.ALPACA_BROKER_API_KEY = "hosted-paper-key";
    process.env.ALPACA_BROKER_API_SECRET = "hosted-paper-secret";
    process.env.ALPACA_BROKER_BASE_URL = "https://paper-api.alpaca.markets";
    const hosted = createPaperBroker();
    assert.equal(hosted.adapter, "ALPACA_PAPER");
    assert.equal(hosted.localOnly, false);
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test("Emergency Stop prevents Alpaca PAPER network execution", async () => {
  let calls = 0;
  const broker = new AlpacaPaperBrokerService(config, async () => {
    calls += 1;
    return Response.json({ id: "should-not-exist" });
  });
  const service = new PaperOrderService(
    broker,
    { refresh: async () => {} },
    new TradePermissionService(
      {
        mode: "PAPER",
        autoTraderStatus: "LOCKED",
        riskState: "LOCKED",
        emergencyStopActive: true,
      },
      defaultRiskSettings,
    ),
  );
  await assert.rejects(
    service.submit({
      symbol: "AAPL",
      direction: "BUY",
      quantity: 1,
      type: "MARKET",
      mode: "PAPER",
      confirmed: true,
    }),
    (error) => error.code === "TRADE_PERMISSION_DENIED",
  );
  assert.equal(calls, 0);
});

test("Auto Trader and Big Money use generic gated cloud broker selection", async () => {
  const [autoRoute, bigRoute, factory, alpacaMarket] = await Promise.all([
    readFile(
      new URL("../app/api/auto-trader/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/api/big-money/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../src/services/broker/factory.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/services/market-data/alpaca-market-data-service.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  for (const route of [autoRoute, bigRoute]) {
    assert.match(route, /createPaperBroker/);
    assert.match(route, /TradePermissionService/);
    assert.match(route, /ProductionRiskManager/);
  }
  assert.match(factory, /ALPACA_PAPER/);
  assert.match(factory, /IBKR_TWS_LOCAL/);
  assert.doesNotMatch(alpacaMarket, /submitPaperOrder|\/v2\/orders/);
});

test("hosted production architecture has no owner-PC runtime dependency", async () => {
  const [factory, runtime, docs] = await Promise.all([
    readFile(
      new URL("../src/services/broker/factory.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/config/runtime.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../OWNER_SETUP_TRADE-009.5.md", import.meta.url),
      "utf8",
    ).catch(() => ""),
  ]);
  assert.match(factory, /createAlpacaPaperBrokerService/);
  assert.match(runtime, /HOSTED_PRODUCTION/);
  assert.match(runtime, /localhost\|127/);
  assert.doesNotMatch(docs, /run .*PowerShell|start-bridge/i);
});
