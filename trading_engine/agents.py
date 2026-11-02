"""Shared role-based agents; one role instance handles many symbols."""
from dataclasses import dataclass
from datetime import datetime, timezone
from .models import AgentResult, MarketSnapshot
from .strategies import trend, momentum, breakout, mean_reversion

# IEX minute bars can be published after the minute closes. The worker scans
# symbols sequentially; allow up to three scan intervals, but never older data.
MARKET_DATA_MAX_AGE_SECONDS = 180

@dataclass
class ResearchAgent:
    max_age_seconds: int = MARKET_DATA_MAX_AGE_SECONDS
    def validate(self, snapshot):
        ok=snapshot.is_fresh(self.max_age_seconds)
        return AgentResult("research","READY" if ok else "BLOCKED","FRESH_MARKET_DATA" if ok else "STALE_OR_INVALID_MARKET_DATA",datetime.now(timezone.utc))

class SmallTradingAgent:
    def evaluate(self,snapshot,closes):
        return [trend(snapshot,closes),momentum(snapshot,closes),breakout(snapshot,closes),mean_reversion(snapshot,closes)]

@dataclass
class PositionMonitoringAgent:
    name: str = "position_monitor"

@dataclass
class PerformanceReportingAgent:
    name: str = "performance_reporting"

@dataclass
class ChiefOrchestrator:
    research: ResearchAgent
    small_trading: SmallTradingAgent
    def run_symbol(self,snapshot,closes):
        health=self.research.validate(snapshot)
        if health.status!="READY": return health,[]
        return health,self.small_trading.evaluate(snapshot,closes)
