"""Read-only performance summary derived only from simulated position ledger events."""
from .positions import PositionLedger


class PerformanceReportingAgent:
    def __init__(self, store):
        self.store = store
        self.ledger = PositionLedger(store)

    def snapshot(self):
        events = self.store.list_events(100000)
        closed = [e["payload"] for e in events if e["event_type"] == "POSITION_CLOSED"]
        pnl_values = [float(p.get("realized_pnl", 0.0)) for p in closed]
        wins = sum(1 for pnl in pnl_values if pnl > 0)
        losses = sum(1 for pnl in pnl_values if pnl < 0)
        total = len(pnl_values)
        return {
            "mode": "PAPER_SIMULATOR_LEDGER",
            "source": "SIMULATED_POSITION_EVENTS_ONLY",
            "closed_positions": total,
            "open_positions": len(self.ledger.list_open()),
            "winning_positions": wins,
            "losing_positions": losses,
            "win_rate_percent": round((wins / total) * 100, 2) if total else None,
            "realized_pnl": round(sum(pnl_values), 8),
            "gross_profit": round(sum(p for p in pnl_values if p > 0), 8),
            "gross_loss": round(sum(p for p in pnl_values if p < 0), 8),
            "execution_enabled": False,
            "reconciliation_status": "NOT_RECONCILED",
        }
