"""Observation-only worker runtime with persistent audit events and heartbeats."""
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

    def _agent_event(self, agent, phase, status, symbol, summary, details=None):
        self.store.append_event("AGENT_ACTIVITY", {
            "agent": agent, "phase": phase, "status": status, "symbol": symbol,
            "summary": summary, "details": details or {}, "execution_enabled": False,
        })

    def _run_symbol(self, symbol):
        self._agent_event("chief_orchestrator", "CYCLE_STARTED", "WORKING", symbol,
                          "Started an observation cycle for " + symbol)
        self._agent_event("research", "DATA_CHECK_STARTED", "WORKING", symbol,
                          "Fetching the latest market observation and strategy history")
        try:
            report = self.cycle.run_symbol(symbol)
            market = {
                "price": report.observed_price,
                "timestamp": report.market_timestamp.isoformat() if report.market_timestamp else None,
                "source": report.market_source,
                "volume": report.volume,
            }
            research_status = "READY" if report.status == "READY" else "BLOCKED"
            self._agent_event("research", "DATA_CHECK_COMPLETED", research_status, symbol,
                              report.message, {"market": market})
            if report.status == "READY":
                signal_rows = [
                    {"strategy": getattr(signal, "strategy", "unknown"),
                     "status": "NO_SIGNAL" if getattr(signal, "side", None) is None else signal.side.value,
                     "score": getattr(signal, "score", 0.0),
                     "reason": getattr(signal, "reason", "")}
                    for signal in report.signals
                ]
                self._agent_event("small_trading", "STRATEGIES_EVALUATED", "COMPLETED", symbol,
                                  "Evaluated four baseline strategies", {"signals": signal_rows})
            else:
                signal_rows = []
                self._agent_event("small_trading", "STRATEGIES_SKIPPED", "BLOCKED", symbol,
                                  "Strategy evaluation skipped because market data was not ready")
            payload = {
                "symbol": report.symbol, "status": report.status, "message": report.message,
                "created_at": report.created_at.isoformat(), "market": market,
                "signals": signal_rows, "execution_enabled": False,
            }
            self.store.append_event("OBSERVATION_CYCLE", payload)
            health_status = "OK" if report.status == "READY" else "DEGRADED"
            self.heartbeat.record(health_status, f"{symbol}:{report.status}")
            self._agent_event("chief_orchestrator", "CYCLE_COMPLETED", "COMPLETED", symbol,
                              "Observation cycle completed; no orders were submitted")
            return report
        except Exception as exc:
            self.store.append_event("OBSERVATION_ERROR", {
                "symbol": symbol, "error_type": type(exc).__name__,
                "message": str(exc)[:240], "execution_enabled": False,
            })
            self._agent_event("research", "CYCLE_FAILED", "ERROR", symbol,
                              "Market observation failed: " + type(exc).__name__)
            self._agent_event("chief_orchestrator", "CYCLE_FAILED", "ERROR", symbol,
                              "Observation cycle failed; no orders were submitted")
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
    try:
        provider = AlpacaIEXMarketDataProvider()
        worker = ObservationWorker(ObservationCycle(provider), store, symbols, interval)
        return worker, store
    except Exception:
        store.close()
        raise
