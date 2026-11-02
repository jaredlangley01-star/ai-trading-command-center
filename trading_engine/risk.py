"""Deterministic risk gate; it never submits broker orders."""
from dataclasses import dataclass
from .models import DecisionStatus, RiskDecision, Side, TradeProposal

@dataclass(frozen=True)
class RiskLimits:
    max_position_value: float = 500.0
    max_loss_per_trade: float = 10.0
    max_daily_loss: float = 25.0
    max_open_positions: int = 3
    max_portfolio_exposure: float = 1500.0

@dataclass(frozen=True)
class RiskContext:
    daily_realized_pnl: float = 0.0
    open_positions: int = 0
    current_exposure: float = 0.0
    emergency_stop: bool = False
    paper_mode: bool = True
    portfolio_context_verified: bool = False
    risk_limits_authorized: bool = False

class RiskManager:
    def __init__(self, limits=RiskLimits()):
        self.limits = limits

    def evaluate(self, proposal: TradeProposal, context: RiskContext) -> RiskDecision:
        reject = lambda reason: RiskDecision(DecisionStatus.REJECTED, reason)
        if not context.paper_mode or proposal.mode != "PAPER":
            return reject("PAPER_MODE_REQUIRED")
        if context.emergency_stop:
            return reject("EMERGENCY_STOP_ACTIVE")
        if not context.portfolio_context_verified:
            return reject("PORTFOLIO_CONTEXT_UNVERIFIED")
        # Default limits are engineering safeguards, not user-approved capital
        # allocation. Never convert them into an approval implicitly.
        if not context.risk_limits_authorized:
            return reject("RISK_LIMITS_NOT_AUTHORIZED")
        if context.daily_realized_pnl <= -abs(self.limits.max_daily_loss):
            return reject("DAILY_LOSS_LIMIT_REACHED")
        if context.open_positions >= self.limits.max_open_positions:
            return reject("MAX_OPEN_POSITIONS_REACHED")
        if proposal.quantity <= 0 or min(proposal.entry, proposal.stop_loss, proposal.take_profit) <= 0:
            return reject("INVALID_ORDER_PARAMETERS")
        if proposal.side == Side.BUY and not proposal.stop_loss < proposal.entry < proposal.take_profit:
            return reject("INVALID_LONG_PRICE_STRUCTURE")
        if proposal.side == Side.SELL and not proposal.take_profit < proposal.entry < proposal.stop_loss:
            return reject("INVALID_SHORT_PRICE_STRUCTURE")
        risk_per_share = abs(proposal.entry - proposal.stop_loss)
        by_risk = int(self.limits.max_loss_per_trade // risk_per_share) if risk_per_share else 0
        by_value = int(self.limits.max_position_value // proposal.entry)
        by_exposure = int(max(0, self.limits.max_portfolio_exposure-context.current_exposure) // proposal.entry)
        approved = min(proposal.quantity, by_risk, by_value, by_exposure)
        if approved < 1:
            return reject("INSUFFICIENT_RISK_CAPACITY")
        loss = approved * risk_per_share
        if approved != proposal.quantity:
            return RiskDecision(DecisionStatus.REJECTED, "PROPOSED_SIZE_EXCEEDS_LIMITS", approved, loss)
        return RiskDecision(DecisionStatus.APPROVED, "RISK_CHECKS_PASSED", approved, loss)
