"""Market-data contracts and safe in-memory provider for development."""
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol
from .models import MarketSnapshot

@dataclass(frozen=True)
class PriceBar:
    symbol: str
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float

class MarketDataProvider(Protocol):
    def latest_snapshot(self, symbol: str) -> MarketSnapshot: ...
    def recent_closes(self, symbol: str, limit: int) -> list[float]: ...

class InMemoryMarketDataProvider:
    """Deterministic fixture provider; never represents live market data."""
    def __init__(self, prices: dict[str, list[float]]):
        self._prices = {key.upper(): list(values) for key, values in prices.items()}
    def latest_snapshot(self, symbol: str) -> MarketSnapshot:
        values = self._prices.get(symbol.upper())
        if not values: raise KeyError(f"No development data for {symbol}")
        return MarketSnapshot(symbol.upper(), values[-1], datetime.now(timezone.utc), "IN_MEMORY_FIXTURE")
    def recent_closes(self, symbol: str, limit: int) -> list[float]:
        if limit < 1: raise ValueError("limit must be positive")
        values = self._prices.get(symbol.upper())
        if not values: raise KeyError(f"No development data for {symbol}")
        return values[-limit:]
