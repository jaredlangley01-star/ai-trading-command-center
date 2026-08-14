import type {
  BrokerAccountSummary,
  BrokerOrder,
  Position,
} from "@/src/domain/models";
import { createPaperBroker } from "./factory";
import { MarketDataEngine } from "../market-data-engine";
import { brokerErrorPayload } from "./errors";
import { getTradingRuntimeMode, runtimeLabel } from "@/src/config/runtime";
import type { BrokerAdapterKind } from "./factory";
export type BrokerDashboardData = {
  source: "DEMO" | "IBKR_PAPER" | "ALPACA_PAPER";
  status: BrokerAccountSummary["status"];
  summary: BrokerAccountSummary | null;
  positions: Position[];
  orders: BrokerOrder[];
  lastError: string | null;
  adapter: BrokerAdapterKind | null;
  brokerProvider: string;
  runtime: string;
  localOnlyWarning: string | null;
  marketDataStatus:
    | "DISCONNECTED"
    | "MARKET_DATA_ACTIVE"
    | "AUTH_REQUIRED"
    | "ERROR";
  marketDataDelayed: boolean;
  marketDataSource: string;
  marketDataLastUpdated: string | null;
  marketDataAgeMs: number | null;
};
export async function loadBrokerDashboard(): Promise<BrokerDashboardData> {
  const runtime = getTradingRuntimeMode();
  const selected = createPaperBroker();
  if (!selected)
    return {
      source: "DEMO",
      status:
        process.env.ALPACA_BROKER_API_KEY ||
        process.env.IBKR_TWS_BRIDGE_URL ||
        process.env.IBKR_GATEWAY_URL
          ? "DISCONNECTED"
          : "AWAITING_SETUP",
      summary: null,
      positions: [],
      orders: [],
      lastError: null,
      adapter: null,
      brokerProvider: "NOT CONNECTED",
      runtime: runtimeLabel(runtime),
      localOnlyWarning: null,
      marketDataStatus: "DISCONNECTED",
      marketDataDelayed: false,
      marketDataSource: "MARKET DATA DISCONNECTED",
      marketDataLastUpdated: null,
      marketDataAgeMs: null,
    };
  try {
    const broker = selected.broker;
    const [summary, positions, orders] = await Promise.all([
      broker.getAccountSummary(),
      broker.getPositions(),
      broker.getOrders(),
    ]);
    let marketDataStatus: BrokerDashboardData["marketDataStatus"] =
      "DISCONNECTED";
    let marketDataDelayed = false;
    if (selected.marketData) {
      const result = await new MarketDataEngine(selected.marketData).snapshot({
        id: "aapl",
        symbol: "AAPL",
        name: "Apple Inc.",
        assetClass: "EQUITY",
        currency: "USD",
      });
      marketDataStatus = result.status;
      marketDataDelayed = result.quote?.isDelayed ?? false;
    }
    return {
      source:
        selected.adapter === "ALPACA_PAPER" ? "ALPACA_PAPER" : "IBKR_PAPER",
      status: "PAPER_CONNECTED",
      summary,
      positions,
      orders,
      lastError: null,
      adapter: selected.adapter,
      brokerProvider:
        selected.adapter === "ALPACA_PAPER"
          ? "Alpaca — PAPER"
          : "Interactive Brokers — LOCAL ONLY",
      runtime: runtimeLabel(runtime),
      localOnlyWarning: selected.localOnly
        ? "LOCAL_ONLY / NOT PRODUCTION ELIGIBLE"
        : null,
      marketDataStatus,
      marketDataDelayed,
      marketDataSource:
        selected.adapter === "ALPACA_PAPER"
          ? "ALPACA — IEX"
          : marketDataDelayed
            ? "IBKR PAPER — DELAYED"
            : "IBKR PAPER DATA",
      marketDataLastUpdated: null,
      marketDataAgeMs: null,
    };
  } catch (error) {
    const failure = brokerErrorPayload(error);
    return {
      source: "DEMO",
      status:
        failure.code === "AUTHENTICATION_EXPIRED" ? "AUTH_REQUIRED" : "ERROR",
      summary: null,
      positions: [],
      orders: [],
      lastError: failure.message,
      adapter: selected.adapter,
      brokerProvider:
        selected.adapter === "ALPACA_PAPER"
          ? "Alpaca — PAPER"
          : "Interactive Brokers — LOCAL ONLY",
      runtime: runtimeLabel(runtime),
      localOnlyWarning: selected.localOnly
        ? "LOCAL_ONLY / NOT PRODUCTION ELIGIBLE"
        : null,
      marketDataStatus:
        failure.code === "AUTHENTICATION_EXPIRED" ? "AUTH_REQUIRED" : "ERROR",
      marketDataDelayed: false,
      marketDataSource: "MARKET DATA DISCONNECTED",
      marketDataLastUpdated: null,
      marketDataAgeMs: null,
    };
  }
}
