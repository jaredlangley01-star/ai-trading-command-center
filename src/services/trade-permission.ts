import type {
  RiskSettings,
  SystemState,
  TradeRecommendation,
} from "@/src/domain/models";
export class TradePermissionService {
  private state: SystemState;
  private settings: RiskSettings;
  constructor(state: SystemState, settings: RiskSettings) {
    this.state = state;
    this.settings = settings;
  }
  canOpenTrade() {
    return !this.state.emergencyStopActive && this.state.mode === "PAPER";
  }
  canApproveRecommendation(recommendation?: TradeRecommendation) {
    return (
      this.canOpenTrade() &&
      (!recommendation || recommendation.status === "PENDING")
    );
  }
  canTradeAutomatically() {
    return (
      this.canOpenTrade() &&
      this.settings.autoTraderEnabled &&
      this.state.autoTraderStatus === "ACTIVE"
    );
  }
  canManageExistingPosition() {
    return this.state.mode === "PAPER";
  }
  getLockReason() {
    return this.state.emergencyStopActive
      ? "Emergency stop is active"
      : this.state.mode === "LIVE"
        ? "Live Trading Safety Gate is incomplete"
        : null;
  }
  getSystemRiskState() {
    return this.state.riskState;
  }
}
export const requestTradingMode = (requested: "PAPER" | "LIVE") =>
  requested === "LIVE"
    ? {
        mode: "PAPER" as const,
        error:
          "Live trading is unavailable until the Live Trading Safety Gate has been completed.",
      }
    : { mode: "PAPER" as const, error: null };
