"""Observation worker with transparent, non-executing risk previews."""
import os
from datetime import timezone
from .cycle import ObservationCycle
from .health import Heartbeat
from .scheduler import CycleScheduler
from .storage import SQLiteStore
from .models import Side, TradeProposal
from .risk import RiskContext, RiskManager
from .positions import PositionLedger, PositionMonitoringAgent


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
        self.risk_manager = RiskManager()
        self.position_ledger = PositionLedger(store)
        self.position_monitor = PositionMonitoringAgent(self.position_ledger)

    def _agent_event(self, agent, phase, status, symbol, summary, details=None):
        self.store.append_event("AGENT_ACTIVITY", {
            "agent": agent, "phase": phase, "status": status, "symbol": symbol,
            "summary": summary, "details": details or {}, "execution_enabled": False,
        })

    def _risk_preview(self, signal, price, symbol, observed_at):
        if signal.side is None:
            return {"status": "NOT_APPLICABLE", "reason": "NO_DIRECTIONAL_SIGNAL", "approved_quantity": 0, "estimated_loss": 0.0}
        stop_distance = price * 0.01
        if signal.side == Side.BUY:
            stop_loss, take_profit = price - stop_distance, price + (2 * stop_distance)
        else:
            stop_loss, take_profit = price + stop_distance, price - (2 * stop_distance)
        limits = self.risk_manager.limits
        by_risk = int(limits.max_loss_per_trade // stop_distance) if stop_distance > 0 else 0
        by_value = int(limits.max_position_value // price) if price > 0 else 0
        quantity = max(1, min(by_risk, by_value))
        proposal = TradeProposal(
            symbol=symbol, side=signal.side, entry=price, stop_loss=stop_loss,
            take_profit=take_profit, quantity=quantity, strategy=signal.strategy,
            created_at=observed_at, mode="PAPER",
        )
        # Until broker positions and daily P&L are reconciled, never mark a
        # proposal approved. This preview cannot submit an order.
        decision = self.risk_manager.evaluate(
            proposal, RiskContext(paper_mode=True, portfolio_context_verified=False)
        )
        return {
            "status": decision.status.value,
            "reason": decision.reason,
            "proposed_quantity": quantity,
            "approved_quantity": decision.approved_quantity,
            "estimated_loss": round(quantity * stop_distance, 4),
            "entry": price, "stop_loss": round(stop_loss, 4),
            "take_profit": round(take_profit, 4),
            "assumptions": "Illustrative 1% stop / 2R target; portfolio context not verified",
        }

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
                for position in self.position_ledger.list_open():
                    if position.symbol != symbol:
                        continue
                    self._agent_event("position_monitor", "POSITION_CHECK_STARTED", "WORKING", symbol,
                                      "Checking simulated position against its stop and target",
                                      {"position_id": position.position_id})
                    updated = self.position_monitor.process_mark(position.position_id, report.observed_price)
                    if updated and updated.status == "CLOSED":
                        self._agent_event("position_monitor", "POSITION_EXIT_TRIGGERED", "COMPLETED", symbol,
                                          "Simulated position closed by " + str(updated.exit_reason),
                                          {"position_id": updated.position_id, "exit_price": updated.exit_price,
                                           "realized_pnl": updated.realized_pnl, "reason": updated.exit_reason})
                    else:
                        self._agent_event("position_monitor", "POSITION_MARKED", "COMPLETED", symbol,
                                          "Simulated position remains open after price check",
                                          {"position_id": position.position_id, "mark_price": report.observed_price})
                signal_rows = []
                risk_reviews = []
                for signal in report.signals:
                    risk = self._risk_preview(signal, report.observed_price, symbol, report.created_at)
                    row = {
                        "strategy": signal.strategy,
                        "status": "NO_SIGNAL" if signal.side is None else signal.side.value,
                        "score": signal.score, "reason": signal.reason, "risk": risk,
                    }
                    signal_rows.append(row)
                    if signal.side is not None:
                        risk_reviews.append({"strategy": signal.strategy, **risk})
                        self._agent_event(
                            "risk_manager", "PRELIMINARY_REVIEW", "BLOCKED",
                            symbol, "Trade candidate blocked pending verified portfolio context",
                            {"strategy": signal.strategy, "signal": signal.side.value, "risk": risk},
                        )
                self._agent_event("small_trading", "STRATEGIES_EVALUATED", "COMPLETED", symbol,
                                  "Evaluated four baseline strategies", {"signals": signal_rows})
                if risk_reviews:
                    self._agent_event("risk_manager", "RISK_REVIEWS_COMPLETED", "BLOCKED", symbol,
                                      "Reviewed directional signals; none approved because portfolio context is not verified",
                                      {"reviews": risk_reviews})
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
