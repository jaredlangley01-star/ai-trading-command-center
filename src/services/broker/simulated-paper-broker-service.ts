import type {
  BrokerAccountSummary,
  BrokerExecution,
  BrokerOrder,
  BrokerOrderRequest,
  BrokerOrderResult,
  Position,
} from "../../domain/models.ts";
import type { BrokerService } from "../contracts.ts";
import { BrokerError } from "./errors.ts";

export class SimulatedPaperBrokerService implements BrokerService {
  async getAccountSummary(): Promise<BrokerAccountSummary> {
    return {
      accountIdMasked: "SIMULATED",
      balance: 100000,
      netLiquidation: 100000,
      availableCash: 100000,
      buyingPower: 100000,
      currency: "USD",
      status: "DISCONNECTED",
      lastSuccessfulSync: null,
      lastError: null,
    };
  }
  async getPositions(): Promise<Position[]> {
    return [];
  }
  async getOrders(): Promise<BrokerOrder[]> {
    return [];
  }
  async getExecutions(): Promise<BrokerExecution[]> {
    return [];
  }
  async submitPaperOrder(
    order: BrokerOrderRequest,
  ): Promise<BrokerOrderResult> {
    if (order.mode !== "PAPER")
      throw new BrokerError("LIVE_TRADING_LOCKED", "Live trading is locked.");
    if (!order.confirmed)
      throw new BrokerError(
        "PAPER_CONFIRMATION_REQUIRED",
        "Paper confirmation is required.",
      );
    return {
      brokerOrderId: `sim-${order.clientOrderId}`,
      status: "FILLED",
      message: "SIMULATED PAPER EXECUTION — no broker order was sent.",
      mode: "PAPER",
    };
  }
  async cancelPaperOrder(orderId: string): Promise<BrokerOrderResult> {
    return {
      brokerOrderId: orderId,
      status: "CANCELLED",
      message: "Simulated paper order cancelled.",
      mode: "PAPER",
    };
  }
}
