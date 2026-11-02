"""Observation-only worker runtime with persistent audit events and heartbeats.

This process scans symbols and records research/strategy observations. It has no
execution gateway and cannot place broker orders.
"""
import os
from .cycle import ObservationCycle
from .health import Heartbeat
from .scheduler import CycleScheduler
from .storage import SQLiteStore


class ObservationWorker:
    def __init__(self, cycle, store, symbols, interval_seconds=60):
        normalized = tuple(dict.fromkeys(s.strip().upper() for s in symbols if s.strip()))
        if not normalized:
            raise ValueError("AT_LEAST_ONE_SYMBOL_REQUIRED")
        self.cycle = cycle
        self.store = store
        self.symbols = normalized
        self.interval_seconds = interval_seconds
        self.heartbeat = Heartbeat(store, component="small-trading-observation-worker")
        self.scheduler = CycleScheduler(self._run_symbol, self.symbols, interval_seconds)

    def _run_symbol(self, symbol):
        try:
            report = self.cycle.run_symbol(symbol)
            payload = {
                "symbol": report.symbol,
                "status": report.status,
                "message": report.message,
                "created_at": report.created_at.isoformat(),
                "signals": [
                    {
                        "strategy": getattr(signal, "strategy", "unknown"),
                        "status": str(getattr(signal, "status", "UNKNOWN")),
                        "reason": getattr(signal, "reason", ""),
                    }
                    for signal in report.signals
                ],
                "execution_enabled": False,
            }
            self.store.append_event("OBSERVATION_CYCLE", payload)
            health_status = "OK" if report.status == "READY" else "DEGRADED"
            self.heartbeat.record(health_status, f"{symbol}:{report.status}")
            return report
        except Exception as exc:
            self.store.append_event("OBSERVATION_ERROR", {
                "symbol": symbol,
                "error_type": type(exc).__name__,
                "message": str(exc)[:240],
                "execution_enabled": False,
            })
            self.heartbeat.record("ERROR", f"{symbol}:{type(exc).__name__}")
            return None

    def run_once(self):
        return [self._run_symbol(symbol) for symbol in self.symbols]

    def run_forever(self):
        self.scheduler.run_forever()


def build_worker_from_environment():
    from .alpaca_market_data import AlpacaIEXMarketDataProvider

    symbols = os.getenv("SMALL_TRADING_SYMBOLS", "AAPL,MSFT,NVDA").split(",")
    interval = int(os.getenv("SMALL_TRADING_SCAN_INTERVAL_SECONDS", "60"))
    database_path = os.getenv("SMALL_TRADING_DATABASE_PATH", "data/trading.db")
    store = SQLiteStore(database_path)
    provider = AlpacaIEXMarketDataProvider()
    return ObservationWorker(ObservationCycle(provider), store, symbols, interval), store
