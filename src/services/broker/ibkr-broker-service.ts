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

type IbkrConfig = { environment: "PAPER"; baseUrl: string; timeoutMs: number };
export function getIbkrPaperConfig(): IbkrConfig | null {
  const environment = process.env.IBKR_ENVIRONMENT?.trim();
  const baseUrl = process.env.IBKR_GATEWAY_URL?.trim();
  if (!baseUrl) return null;
  if (environment !== "PAPER")
    throw new BrokerError(
      "LIVE_TRADING_LOCKED",
      "IBKR environment must be explicitly PAPER.",
    );
  return {
    environment: "PAPER",
    baseUrl: baseUrl.replace(/\/$/, ""),
    timeoutMs: Number(process.env.IBKR_REQUEST_TIMEOUT_MS) || 10000,
  };
}
const mask = (id: string) =>
  id.length < 5 ? "••••" : `${id.slice(0, 1)}••••${id.slice(-3)}`;
export class IBKRBrokerService implements BrokerService {
  private readonly config: IbkrConfig;
  constructor(config: IbkrConfig) {
    this.config = config;
    if (config.environment !== "PAPER")
      throw new BrokerError(
        "LIVE_TRADING_LOCKED",
        "Live IBKR adapters are prohibited.",
      );
  }
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...init?.headers },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403)
        throw new BrokerError(
          "AUTHENTICATION_EXPIRED",
          "IBKR paper authentication has expired.",
        );
      if (response.status === 429)
        throw new BrokerError(
          "RATE_LIMIT",
          "IBKR paper rate limit reached.",
          true,
        );
      if (!response.ok)
        throw new BrokerError(
          response.status === 503 ? "DISCONNECTED_SESSION" : "IBKR_UNAVAILABLE",
          `IBKR paper request failed (${response.status}).`,
          response.status >= 500,
        );
      try {
        return (await response.json()) as T;
      } catch {
        throw new BrokerError(
          "MALFORMED_RESPONSE",
          "IBKR returned a malformed response.",
        );
      }
    } catch (error) {
      if (error instanceof BrokerError) throw error;
      if (error instanceof Error && error.name === "AbortError")
        throw new BrokerError("TIMEOUT", "IBKR paper request timed out.", true);
      throw new BrokerError(
        "GATEWAY_UNAVAILABLE",
        "IBKR Client Portal Gateway is unavailable.",
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  async accountId() {
    const data = await this.request<{
      accounts?: string[];
      selectedAccount?: string;
    }>("/iserver/accounts");
    const id = data.selectedAccount ?? data.accounts?.[0];
    if (!id)
      throw new BrokerError(
        "ACCOUNT_UNAVAILABLE",
        "No IBKR paper account is available.",
      );
    return id;
  }
  async getAccountSummary(): Promise<BrokerAccountSummary> {
    const id = await this.accountId();
    const data = await this.request<
      Record<string, { amount?: number; currency?: string }>
    >(`/portfolio/${encodeURIComponent(id)}/summary`);
    return {
      accountIdMasked: mask(id),
      balance: data.totalcashvalue?.amount ?? null,
      netLiquidation: data.netliquidation?.amount ?? null,
      availableCash: data.availablefunds?.amount ?? null,
      buyingPower: data.buyingpower?.amount ?? null,
      currency: data.netliquidation?.currency ?? "USD",
      status: "PAPER_CONNECTED",
      lastSuccessfulSync: new Date().toISOString(),
      lastError: null,
    };
  }
  async getPositions(): Promise<Position[]> {
    const id = await this.accountId();
    const rows = await this.request<Array<Record<string, unknown>>>(
      `/portfolio/${encodeURIComponent(id)}/positions/0`,
    );
    return rows.map((p, i) => ({
      id: String(p.conid ?? i),
      symbol: String(p.ticker ?? p.contractDesc ?? "UNKNOWN"),
      direction: Number(p.position) >= 0 ? "BUY" : "SELL",
      entryPrice: Number(p.avgPrice ?? 0),
      currentPrice: Number(p.mktPrice ?? 0),
      investment: Math.abs(Number(p.mktValue ?? 0)),
      profitLoss: Number(p.unrealizedPnl ?? 0),
      stopLoss: 0,
      takeProfit: 0,
      mode: "PAPER",
    }));
  }
  async getOrders(): Promise<BrokerOrder[]> {
    const data = await this.request<{
      orders?: Array<Record<string, unknown>>;
    }>("/iserver/account/orders");
    return (data.orders ?? []).map((o) => ({
      id: String(o.orderId ?? o.order_id),
      symbol: String(o.ticker ?? o.symbol ?? "UNKNOWN"),
      direction: String(o.side).toUpperCase() === "SELL" ? "SELL" : "BUY",
      quantity: Number(o.totalSize ?? o.total_size ?? 0),
      type: String(o.orderType ?? o.order_type).includes("LMT")
        ? "LIMIT"
        : "MARKET",
      status: "ACCEPTED",
    }));
  }
  async getExecutions(): Promise<BrokerExecution[]> {
    const data = await this.request<Array<Record<string, unknown>>>(
      "/iserver/account/trades",
    );
    return data.map((e, i) => ({
      id: String(e.execution_id ?? i),
      orderId: String(e.order_ref ?? e.orderId ?? ""),
      symbol: String(e.symbol ?? "UNKNOWN"),
      quantity: Number(e.size ?? 0),
      price: Number(e.price ?? 0),
      executedAt: String(e.trade_time_r ?? new Date().toISOString()),
    }));
  }
  private async conid(symbol: string) {
    const rows = await this.request<Array<{ conid?: number }>>(
      `/iserver/secdef/search?symbol=${encodeURIComponent(symbol)}`,
    );
    if (!rows[0]?.conid)
      throw new BrokerError(
        "MALFORMED_RESPONSE",
        "IBKR could not resolve the paper symbol.",
      );
    return rows[0].conid;
  }
  async submitPaperOrder(
    order: BrokerOrderRequest,
  ): Promise<BrokerOrderResult> {
    if (order.mode !== "PAPER")
      throw new BrokerError(
        "LIVE_TRADING_LOCKED",
        "Live order execution is locked.",
      );
    if (!order.confirmed)
      throw new BrokerError(
        "PAPER_CONFIRMATION_REQUIRED",
        "Explicit paper-order confirmation is required.",
      );
    if (order.type === "LIMIT" && !order.limitPrice)
      throw new BrokerError("ORDER_REJECTED", "A limit price is required.");
    const accountId = await this.accountId();
    const conid = await this.conid(order.symbol);
    const result = await this.request<Array<Record<string, unknown>>>(
      `/iserver/account/${encodeURIComponent(accountId)}/orders`,
      {
        method: "POST",
        body: JSON.stringify({
          orders: [
            {
              acctId: accountId,
              conid,
              orderType: order.type === "MARKET" ? "MKT" : "LMT",
              side: order.direction,
              quantity: order.quantity,
              tif: "DAY",
              ...(order.limitPrice ? { price: order.limitPrice } : {}),
            },
          ],
        }),
      },
    );
    const first = result[0] ?? {};
    if (first.error)
      throw new BrokerError("ORDER_REJECTED", String(first.error));
    return {
      brokerOrderId: String(first.order_id ?? first.id ?? ""),
      status: first.message ? "ACCEPTED" : "SUBMITTED",
      message: "IBKR paper order submitted. No live account was used.",
      mode: "PAPER",
    };
  }
  async cancelPaperOrder(orderId: string): Promise<BrokerOrderResult> {
    const accountId = await this.accountId();
    await this.request(
      `/iserver/account/${encodeURIComponent(accountId)}/order/${encodeURIComponent(orderId)}`,
      { method: "DELETE" },
    );
    return {
      brokerOrderId: orderId,
      status: "CANCELLED",
      message: "IBKR paper order cancelled.",
      mode: "PAPER",
    };
  }
}
export function createIbkrBrokerService() {
  const config = getIbkrPaperConfig();
  return config ? new IBKRBrokerService(config) : null;
}
