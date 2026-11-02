"""Read-only portfolio view for the local simulator; not broker reconciliation."""
from dataclasses import asdict
from .positions import PositionLedger
from .storage import SQLiteStore


class PortfolioSnapshot:
    def __init__(self, broker, ledger: PositionLedger, store: SQLiteStore):
        self.broker, self.ledger, self.store = broker, ledger, store

    def build(self):
        open_positions = self.ledger.list_open()
        rows = []
        unrealized = 0.0
        exposure = 0.0
        for position in open_positions:
            mark = position.last_price or position.entry_price
            direction = 1 if position.side == "BUY" else -1
            pnl = (mark - position.entry_price) * position.quantity * direction
            market_value = mark * position.quantity
            unrealized += pnl
            exposure += market_value
            rows.append({
                **asdict(position),
                "mark_price": mark,
                "market_value": round(market_value, 8),
                "unrealized_pnl": round(pnl, 8),
            })
        events = self.store.list_events(100000)
        realized = sum(
            float(e["payload"].get("realized_pnl", 0.0))
            for e in events if e["event_type"] == "POSITION_CLOSED"
        )
        return {
            "mode": "PAPER_SIMULATOR",
            "broker_cash_unsettled": round(self.broker.cash, 8),
            "open_position_count": len(rows),
            "gross_open_exposure": round(exposure, 8),
            "realized_pnl_from_ledger": round(realized, 8),
            "unrealized_pnl": round(unrealized, 8),
            "positions": rows,
            "reconciliation_status": "NOT_RECONCILED",
            "note": "Simulator cash is not settled when ledger positions close; do not treat this as account equity or broker balance.",
        }
