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

    def fetch_observation(self, symbol: str, limit: int = 100):
        """Return a snapshot and strategy window from one consistent read."""
        if limit < 1:
            raise ValueError("limit must be positive")
        values = self._prices.get(symbol.upper())
        if not values:
            raise KeyError(f"No development data for {symbol}")
        snapshot = MarketSnapshot(
            symbol.upper(), values[-1], datetime.now(timezone.utc), "IN_MEMORY_FIXTURE"
        )
        return snapshot, values[-limit:]

    def latest_snapshot(self, symbol: str) -> MarketSnapshot:
        return self.fetch_observation(symbol, 1)[0]

    def recent_closes(self, symbol: str, limit: int) -> list[float]:
        return self.fetch_observation(symbol, limit)[1]
