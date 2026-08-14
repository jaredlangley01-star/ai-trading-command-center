import type { BrokerService, MarketDataService } from "../contracts.ts";
import type {
  Asset,
  BrokerAccountSummary,
  BrokerExecution,
  BrokerOrder,
  BrokerOrderRequest,
  BrokerOrderResult,
  HistoricalCandle,
  MarketQuote,
  Position,
} from "../../domain/models.ts";
import { BrokerError } from "./errors.ts";
type TwsConfig = {
  environment: "PAPER";
  bridgeUrl: string;
  twsHost: string;
  twsPort: 4002 | 7497;
  clientId: number;
  timeoutMs: number;
};
export function getTwsPaperConfig(): TwsConfig | null {
  const bridgeUrl = process.env.IBKR_TWS_BRIDGE_URL?.trim();
  if (!bridgeUrl) return null;
  if (process.env.IBKR_ENVIRONMENT !== "PAPER")
    throw new BrokerError(
      "LIVE_TRADING_LOCKED",
      "TWS environment must be explicitly PAPER.",
    );
  const port = Number(process.env.IBKR_TWS_PORT ?? 4002);
  if (port !== 4002 && port !== 7497)
    throw new BrokerError(
      "LIVE_TRADING_LOCKED",
      "Only paper ports 4002 and 7497 are allowed.",
    );
  return {
    environment: "PAPER",
    bridgeUrl: bridgeUrl.replace(/\/$/, ""),
    twsHost: process.env.IBKR_TWS_HOST?.trim() || "127.0.0.1",
    twsPort: port,
    clientId: Number(process.env.IBKR_TWS_CLIENT_ID) || 41,
    timeoutMs: Number(process.env.IBKR_REQUEST_TIMEOUT_MS) || 10000,
  };
}
export class IBGatewayBrokerService
  implements BrokerService, MarketDataService
{
  private config: TwsConfig;
  constructor(config: TwsConfig) {
    if (
      config.environment !== "PAPER" ||
      ![4002, 7497].includes(config.twsPort)
    )
      throw new BrokerError(
        "LIVE_TRADING_LOCKED",
        "Live TWS connections are prohibited.",
      );
    this.config = config;
  }
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.bridgeUrl}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...init?.headers },
        signal: controller.signal,
      });
      if (response.status === 401)
        throw new BrokerError(
          "AUTHENTICATION_EXPIRED",
          "IB Gateway paper authentication is required.",
        );
      if (response.status === 429)
        throw new BrokerError(
          "RATE_LIMIT",
          "TWS API pacing limit reached.",
          true,
        );
      if (!response.ok)
        throw new BrokerError(
          response.status === 503 ? "DISCONNECTED_SESSION" : "IBKR_UNAVAILABLE",
          `IB Gateway paper bridge failed (${response.status}).`,
          response.status >= 500,
        );
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof BrokerError) throw error;
      if (error instanceof Error && error.name === "AbortError")
        throw new BrokerError("TIMEOUT", "IB Gateway request timed out.", true);
      throw new BrokerError(
        "GATEWAY_UNAVAILABLE",
        "IB Gateway/TWS paper bridge is unavailable.",
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  private context() {
    return {
      environment: "PAPER",
      host: this.config.twsHost,
      port: this.config.twsPort,
      clientId: this.config.clientId,
    };
  }
  getAccountSummary() {
    return this.request<BrokerAccountSummary>("/v1/account/summary", {
      method: "POST",
      body: JSON.stringify(this.context()),
    });
  }
  getPositions() {
    return this.request<Position[]>("/v1/account/positions", {
      method: "POST",
      body: JSON.stringify(this.context()),
    });
  }
  getOrders() {
    return this.request<BrokerOrder[]>("/v1/account/orders", {
      method: "POST",
      body: JSON.stringify(this.context()),
    });
  }
  getExecutions() {
    return this.request<BrokerExecution[]>("/v1/account/executions", {
      method: "POST",
      body: JSON.stringify(this.context()),
    });
  }
  submitPaperOrder(order: BrokerOrderRequest): Promise<BrokerOrderResult> {
    if (order.mode !== "PAPER")
      throw new BrokerError(
        "LIVE_TRADING_LOCKED",
        "Live TWS orders are locked.",
      );
    if (!order.confirmed)
      throw new BrokerError(
        "PAPER_CONFIRMATION_REQUIRED",
        "Paper confirmation is required.",
      );
    return this.request("/v1/orders", {
      method: "POST",
      body: JSON.stringify({ ...this.context(), ...order, mode: "PAPER" }),
    });
  }
  cancelPaperOrder(orderId: string): Promise<BrokerOrderResult> {
    return this.request(`/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
      method: "POST",
      body: JSON.stringify(this.context()),
    });
  }
  getQuote(asset: Asset): Promise<MarketQuote> {
    return this.request<MarketQuote>("/v1/market/quote", {
      method: "POST",
      body: JSON.stringify({
        ...this.context(),
        symbol: asset.symbol,
        assetClass: asset.assetClass,
        currency: asset.currency,
      }),
    }).then((quote) => ({
      ...quote,
      provider: "IBKR",
      feed: quote.isDelayed ? "DELAYED" : "REALTIME",
    }));
  }
  getHistoricalCandles(
    asset: Asset,
    duration: string,
    barSize: string,
  ): Promise<HistoricalCandle[]> {
    return this.request("/v1/market/history", {
      method: "POST",
      body: JSON.stringify({
        ...this.context(),
        symbol: asset.symbol,
        assetClass: asset.assetClass,
        currency: asset.currency,
        duration,
        barSize,
      }),
    });
  }
}
export function createTwsBrokerService() {
  const config = getTwsPaperConfig();
  return config ? new IBGatewayBrokerService(config) : null;
}
