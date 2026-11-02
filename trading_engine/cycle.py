"""Observation-only trading cycle; intentionally has no order-submission path."""
from dataclasses import dataclass
from datetime import datetime, timezone
from .agents import ChiefOrchestrator, ResearchAgent, SmallTradingAgent
from .market_data import MarketDataProvider

@dataclass(frozen=True)
class CycleReport:
    symbol: str
    status: str
    message: str
    signals: tuple
    created_at: datetime
    observed_price: float | None = None
    market_timestamp: datetime | None = None
    market_source: str | None = None
    volume: float | None = None

class ObservationCycle:
    def __init__(self, provider: MarketDataProvider, orchestrator: ChiefOrchestrator | None = None):
        self.provider = provider
        self.orchestrator = orchestrator or ChiefOrchestrator(ResearchAgent(), SmallTradingAgent())

    def run_symbol(self, symbol: str) -> CycleReport:
        try:
            snapshot = self.provider.latest_snapshot(symbol)
            closes = self.provider.recent_closes(symbol, 100)
            health, signals = self.orchestrator.run_symbol(snapshot, closes)
            return CycleReport(
                symbol.upper(), health.status, health.message, tuple(signals),
                datetime.now(timezone.utc), snapshot.price, snapshot.timestamp,
                snapshot.source, getattr(snapshot, "volume", None),
            )
        except (KeyError, ValueError) as exc:
            return CycleReport(symbol.upper(), "BLOCKED", f"DATA_UNAVAILABLE: {exc}", tuple(), datetime.now(timezone.utc))
