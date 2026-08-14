import type { BrokerOrderRequest, SystemState } from "../../domain/models.ts";
import type { BrokerService } from "../contracts.ts";
import { BrokerError } from "./errors.ts";

export type ProtectiveExit = {
  symbol: string;
  direction: "BUY" | "SELL";
  quantity: number;
  openQuantity: number;
  reason: "STOP_LOSS" | "TAKE_PROFIT";
  clientOrderId: string;
};

export class ProtectiveExitService {
  private readonly broker: BrokerService;
  private readonly state: SystemState;
  constructor(broker: BrokerService, state: SystemState) {
    this.broker = broker;
    this.state = state;
  }

  async submit(exit: ProtectiveExit) {
    if (this.state.mode !== "PAPER")
      throw new BrokerError("LIVE_TRADING_LOCKED", "LIVE exits are locked.");
    if (exit.quantity <= 0 || exit.quantity > exit.openQuantity)
      throw new BrokerError(
        "TRADE_PERMISSION_DENIED",
        "A protective exit may only reduce an existing PAPER position.",
      );
    const order: BrokerOrderRequest = {
      symbol: exit.symbol,
      direction: exit.direction,
      quantity: exit.quantity,
      type: "MARKET",
      mode: "PAPER",
      confirmed: true,
      clientOrderId: exit.clientOrderId,
      source: "POSITION_MANAGER",
    };
    return this.broker.submitPaperOrder(order);
  }
}
