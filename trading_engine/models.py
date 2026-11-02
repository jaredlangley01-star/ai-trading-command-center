"""Shared typed domain models."""
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import StrEnum

def utc_now(): return datetime.now(timezone.utc)

class Side(StrEnum):
    BUY = "BUY"
    SELL = "SELL"

class DecisionStatus(StrEnum):
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"

@dataclass(frozen=True)
class MarketSnapshot:
    symbol: str
    price: float
    timestamp: datetime
    source: str
    volume: float = 0.0
    def is_fresh(self, max_age_seconds: int, now=None):
        age = ((now or utc_now()) - self.timestamp).total_seconds()
        return 0 <= age <= max_age_seconds and self.price > 0

@dataclass(frozen=True)
class TradeProposal:
    symbol: str
    side: Side
    entry: float
    stop_loss: float
    take_profit: float
    quantity: int
    strategy: str
    created_at: datetime
    mode: str = "PAPER"

@dataclass(frozen=True)
class RiskDecision:
    status: DecisionStatus
    reason: str
    approved_quantity: int = 0
    estimated_loss: float = 0.0

@dataclass(frozen=True)
class AgentResult:
    agent: str
    status: str
    message: str
    created_at: datetime
