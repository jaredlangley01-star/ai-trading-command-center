import type { BrokerService, MarketDataService } from "../contracts.ts";
import {
  assertHostedBrokerEligible,
  getTradingRuntimeMode,
} from "../../config/runtime.ts";
import { createAlpacaPaperBrokerService } from "./alpaca-paper-broker-service.ts";
import { createIbkrBrokerService } from "./ibkr-broker-service.ts";
import {
  createTwsBrokerService,
  IBGatewayBrokerService,
} from "./ib-gateway-broker-service.ts";
export type BrokerAdapterKind =
  | "ALPACA_PAPER"
  | "IBKR_TWS_LOCAL"
  | "IBKR_CLIENT_PORTAL_LOCAL";
export function createPaperBroker(): {
  broker: BrokerService;
  marketData: MarketDataService | null;
  adapter: BrokerAdapterKind;
  localOnly: boolean;
} | null {
  const runtime = getTradingRuntimeMode();
  const configured = process.env.BROKER_ADAPTER?.toUpperCase();
  const legacy = process.env.IBKR_ADAPTER?.toUpperCase();
  const adapter =
    configured ??
    (legacy === "CLIENT_PORTAL"
      ? "IBKR_CLIENT_PORTAL_LOCAL"
      : legacy === "TWS"
        ? "IBKR_TWS_LOCAL"
        : "ALPACA_PAPER");
  const endpoint =
    adapter === "ALPACA_PAPER"
      ? (process.env.ALPACA_BROKER_BASE_URL ??
        "https://paper-api.alpaca.markets")
      : `${process.env.IBKR_GATEWAY_URL ?? ""} ${process.env.IBKR_TWS_BRIDGE_URL ?? ""}`;
  assertHostedBrokerEligible(runtime, adapter, endpoint);
  if (adapter === "ALPACA_PAPER") {
    const broker = createAlpacaPaperBrokerService();
    return broker
      ? { broker, marketData: null, adapter: "ALPACA_PAPER", localOnly: false }
      : null;
  }
  if (runtime !== "LOCAL_DEVELOPMENT") return null;
  if (adapter === "IBKR_CLIENT_PORTAL_LOCAL") {
    const broker = createIbkrBrokerService();
    return broker
      ? {
          broker,
          marketData: null,
          adapter: "IBKR_CLIENT_PORTAL_LOCAL",
          localOnly: true,
        }
      : null;
  }
  if (adapter !== "IBKR_TWS_LOCAL") return null;
  const broker = createTwsBrokerService();
  return broker
    ? {
        broker,
        marketData: broker instanceof IBGatewayBrokerService ? broker : null,
        adapter: "IBKR_TWS_LOCAL",
        localOnly: true,
      }
    : null;
}
