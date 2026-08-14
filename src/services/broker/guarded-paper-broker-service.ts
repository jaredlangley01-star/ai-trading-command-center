import type {
  BrokerOrderRequest,
  BrokerOrderResult,
} from "../../domain/models.ts";
import type { BrokerService } from "../contracts.ts";
import { BrokerError } from "./errors.ts";

export class GuardedPaperBrokerService implements BrokerService {
  private broker: BrokerService;
  private canSubmitNow: () => Promise<boolean>;
  constructor(broker: BrokerService, canSubmitNow: () => Promise<boolean>) {
    this.broker = broker;
    this.canSubmitNow = canSubmitNow;
  }
  getAccountSummary() {
    return this.broker.getAccountSummary();
  }
  getPositions() {
    return this.broker.getPositions();
  }
  getOrders() {
    return this.broker.getOrders();
  }
  getExecutions() {
    return this.broker.getExecutions();
  }
  async submitPaperOrder(
    order: BrokerOrderRequest,
  ): Promise<BrokerOrderResult> {
    if (order.mode !== "PAPER")
      throw new BrokerError("LIVE_TRADING_LOCKED", "Live trading is locked.");
    if (!(await this.canSubmitNow()))
      throw new BrokerError(
        "TRADE_PERMISSION_DENIED",
        "Emergency Stop or Auto Trader lock became active before execution.",
      );
    return this.broker.submitPaperOrder(order);
  }
  cancelPaperOrder(orderId: string) {
    return this.broker.cancelPaperOrder(orderId);
  }
}
