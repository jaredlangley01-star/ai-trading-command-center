import type {
  BrokerOrderRequest,
  BrokerOrderResult,
  TradeRiskContext,
  RiskSettings,
  SystemState,
} from "@/src/domain/models";
import type { BrokerService, RiskManager } from "@/src/services/contracts";
import { TradePermissionService } from "../trade-permission.ts";
import { BrokerError, RiskDecisionError } from "./errors.ts";
export class PaperOrderService {
  private broker: BrokerService;
  private riskManager: RiskManager;
  private permission: TradePermissionService;
  constructor(
    broker: BrokerService,
    riskManager: RiskManager,
    permission: TradePermissionService,
  ) {
    this.broker = broker;
    this.riskManager = riskManager;
    this.permission = permission;
  }
  async submit(
    order: BrokerOrderRequest,
    riskContext?: TradeRiskContext,
  ): Promise<BrokerOrderResult> {
    if (order.mode !== "PAPER")
      throw new BrokerError("LIVE_TRADING_LOCKED", "Live trading is locked.");
    if (!order.confirmed)
      throw new BrokerError(
        "PAPER_CONFIRMATION_REQUIRED",
        "Paper order confirmation is required.",
      );
    if (this.riskManager.evaluateOrder) {
      if (!riskContext)
        throw new BrokerError(
          "TRADE_PERMISSION_DENIED",
          "A complete risk context is required before submission.",
        );
      const decision = await this.riskManager.evaluateOrder(riskContext);
      if (decision.status !== "APPROVED") throw new RiskDecisionError(decision);
    }
    if (!this.permission.canOpenTrade())
      throw new BrokerError(
        "TRADE_PERMISSION_DENIED",
        this.permission.getLockReason() ?? "Trade permission denied.",
      );
    if (!this.riskManager.evaluateOrder) await this.riskManager.refresh();
    return this.broker.submitPaperOrder(order);
  }
}
export const createPaperPermission = (
  state: SystemState,
  settings: RiskSettings,
) => new TradePermissionService(state, settings);
