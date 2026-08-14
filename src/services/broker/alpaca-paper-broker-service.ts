import type { BrokerService } from "../contracts.ts";
import type {
  BrokerAccountSummary,
  BrokerExecution,
  BrokerOrder,
  BrokerOrderRequest,
  BrokerOrderResult,
  Position,
} from "../../domain/models.ts";
import { BrokerError } from "./errors.ts";

export type AlpacaPaperBrokerConfig = {
  environment: "PAPER";
  baseUrl: "https://paper-api.alpaca.markets";
  apiKey: string;
  apiSecret: string;
  timeoutMs: number;
};

export class AlpacaPaperBrokerService implements BrokerService {
  private readonly config: AlpacaPaperBrokerConfig;
  private readonly fetcher: typeof fetch;
  constructor(config: AlpacaPaperBrokerConfig, fetcher: typeof fetch = fetch) {
    if (
      config.environment !== "PAPER" ||
      config.baseUrl !== "https://paper-api.alpaca.markets"
    )
      throw new BrokerError(
        "LIVE_TRADING_LOCKED",
        "Only Alpaca PAPER Trading API is permitted.",
      );
    this.config = config;
    this.fetcher = fetcher;
  }
  async getAccountSummary(): Promise<BrokerAccountSummary> {
    const account = await this.request<Record<string, unknown>>("/v2/account");
    return {
      accountIdMasked: mask(String(account.account_number ?? "")),
      balance: numberOrNull(account.equity),
      netLiquidation: numberOrNull(account.portfolio_value),
      availableCash: numberOrNull(account.cash),
      buyingPower: numberOrNull(account.buying_power),
      currency: String(account.currency ?? "USD"),
      status: "PAPER_CONNECTED",
      lastSuccessfulSync: new Date().toISOString(),
      lastError: null,
    };
  }
  async getPositions(): Promise<Position[]> {
    const rows =
      await this.request<Array<Record<string, unknown>>>("/v2/positions");
    return rows.map((position) => ({
      id: String(position.asset_id ?? position.symbol),
      symbol: String(position.symbol),
      direction: String(position.side) === "short" ? "SELL" : "BUY",
      entryPrice: Number(position.avg_entry_price ?? 0),
      currentPrice: Number(position.current_price ?? 0),
      investment: Math.abs(Number(position.market_value ?? 0)),
      profitLoss: Number(position.unrealized_pl ?? 0),
      stopLoss: 0,
      takeProfit: 0,
      mode: "PAPER",
    }));
  }
  async getOrders(): Promise<BrokerOrder[]> {
    const rows = await this.request<Array<Record<string, unknown>>>(
      "/v2/orders?status=open&direction=desc",
    );
    return rows.map(normalizeOrder);
  }
  async getExecutions(): Promise<BrokerExecution[]> {
    const rows = await this.request<Array<Record<string, unknown>>>(
      "/v2/account/activities/FILL?direction=desc&page_size=100",
    );
    return rows.map((fill, index) => ({
      id: String(fill.id ?? fill.activity_id ?? index),
      orderId: String(fill.order_id ?? ""),
      symbol: String(fill.symbol ?? "UNKNOWN"),
      quantity: Number(fill.qty ?? 0),
      price: Number(fill.price ?? 0),
      executedAt: String(fill.transaction_time ?? new Date().toISOString()),
    }));
  }
  async submitPaperOrder(
    order: BrokerOrderRequest,
  ): Promise<BrokerOrderResult> {
    if (order.mode !== "PAPER")
      throw new BrokerError(
        "LIVE_TRADING_LOCKED",
        "Alpaca LIVE trading is locked.",
      );
    if (!order.confirmed)
      throw new BrokerError(
        "PAPER_CONFIRMATION_REQUIRED",
        "Explicit PAPER confirmation is required.",
      );
    if (order.type === "LIMIT" && (!order.limitPrice || order.limitPrice <= 0))
      throw new BrokerError(
        "ORDER_REJECTED",
        "A positive limit price is required.",
      );
    const result = await this.request<Record<string, unknown>>("/v2/orders", {
      method: "POST",
      body: JSON.stringify({
        symbol: order.symbol.toUpperCase(),
        qty: String(order.quantity),
        side: order.direction.toLowerCase(),
        type: order.type.toLowerCase(),
        time_in_force: "day",
        client_order_id: order.clientOrderId,
        ...(order.type === "LIMIT"
          ? { limit_price: String(order.limitPrice) }
          : {}),
      }),
    });
    return {
      brokerOrderId: String(result.id ?? ""),
      status: normalizeStatus(String(result.status ?? "new")),
      message: "Alpaca PAPER order accepted. No live account was used.",
      mode: "PAPER",
    };
  }
  async cancelPaperOrder(orderId: string): Promise<BrokerOrderResult> {
    await this.request(`/v2/orders/${encodeURIComponent(orderId)}`, {
      method: "DELETE",
    });
    return {
      brokerOrderId: orderId,
      status: "CANCELLED",
      message: "Alpaca PAPER order cancellation accepted.",
      mode: "PAPER",
    };
  }
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetcher(`${this.config.baseUrl}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          "APCA-API-KEY-ID": this.config.apiKey,
          "APCA-API-SECRET-KEY": this.config.apiSecret,
          ...init?.headers,
        },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403)
        throw new BrokerError(
          "AUTHENTICATION_EXPIRED",
          "Alpaca PAPER broker credentials were rejected.",
        );
      if (response.status === 429)
        throw new BrokerError(
          "RATE_LIMIT",
          "Alpaca PAPER rate limit reached.",
          true,
        );
      if (!response.ok)
        throw new BrokerError(
          response.status >= 500 ? "GATEWAY_UNAVAILABLE" : "ORDER_REJECTED",
          `Alpaca PAPER broker request failed (${response.status}).`,
          response.status >= 500,
        );
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof BrokerError) throw error;
      if (error instanceof Error && error.name === "AbortError")
        throw new BrokerError(
          "TIMEOUT",
          "Alpaca PAPER request timed out.",
          true,
        );
      throw new BrokerError(
        "GATEWAY_UNAVAILABLE",
        "Alpaca PAPER broker is unavailable.",
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createAlpacaPaperBrokerService() {
  const apiKey = process.env.ALPACA_BROKER_API_KEY;
  const apiSecret = process.env.ALPACA_BROKER_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  if ((process.env.ALPACA_BROKER_ENVIRONMENT ?? "PAPER") !== "PAPER")
    throw new BrokerError(
      "LIVE_TRADING_LOCKED",
      "Alpaca LIVE trading is locked.",
    );
  const baseUrl =
    process.env.ALPACA_BROKER_BASE_URL ?? "https://paper-api.alpaca.markets";
  if (baseUrl !== "https://paper-api.alpaca.markets")
    throw new BrokerError(
      "LIVE_TRADING_LOCKED",
      "Only the Alpaca PAPER API domain is permitted.",
    );
  return new AlpacaPaperBrokerService({
    environment: "PAPER",
    baseUrl,
    apiKey,
    apiSecret,
    timeoutMs: Number(process.env.ALPACA_BROKER_TIMEOUT_MS ?? 10000),
  });
}

const mask = (value: string) =>
  value.length > 4 ? `****${value.slice(-4)}` : "****";
const numberOrNull = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : null;
const normalizeStatus = (status: string): BrokerOrderResult["status"] =>
  status === "filled"
    ? "FILLED"
    : status === "canceled"
      ? "CANCELLED"
      : status === "rejected"
        ? "REJECTED"
        : status === "accepted" || status === "new"
          ? "ACCEPTED"
          : "SUBMITTED";
const normalizeOrder = (order: Record<string, unknown>): BrokerOrder => ({
  id: String(order.id),
  symbol: String(order.symbol ?? "UNKNOWN"),
  direction: String(order.side) === "sell" ? "SELL" : "BUY",
  quantity: Number(order.qty ?? 0),
  type: String(order.type) === "limit" ? "LIMIT" : "MARKET",
  status: normalizeStatus(String(order.status ?? "new")),
  submittedAt: String(order.submitted_at ?? ""),
});
