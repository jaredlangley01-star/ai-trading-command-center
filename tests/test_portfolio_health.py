from datetime import datetime, timedelta, timezone

from trading_engine.broker import SimulatedPaperBroker
from trading_engine.health import Heartbeat, HealthSnapshot
from trading_engine.portfolio import PortfolioSnapshot
from trading_engine.positions import PositionLedger
from trading_engine.storage import SQLiteStore


def test_portfolio_snapshot_reports_positions_and_unreconciled_cash():
    store = SQLiteStore(":memory:")
    broker = SimulatedPaperBroker(10000)
    ledger = PositionLedger(store)
    fill = {
        "simulated": True, "status": "SIMULATED_FILLED", "order_id": "SIM-1",
        "symbol": "AAPL", "side": "BUY", "quantity": 2, "fill_price": 100,
    }
    ledger.open_from_fill(fill, 95, 110, "test")
    ledger.mark("SIM-1", 105)
    snapshot = PortfolioSnapshot(broker, ledger, store).build()
    assert snapshot["open_position_count"] == 1
    assert snapshot["unrealized_pnl"] == 10
    assert snapshot["gross_open_exposure"] == 210
    assert snapshot["reconciliation_status"] == "NOT_RECONCILED"
    store.close()


def test_health_unknown_ok_and_stale():
    store = SQLiteStore(":memory:")
    health = HealthSnapshot(store, stale_after_seconds=60)
    assert health.build()["status"] == "UNKNOWN"
    beat = Heartbeat(store)
    beat.record("OK", "cycle completed")
    assert health.build()["status"] == "OK"
    future = datetime.now(timezone.utc) + timedelta(minutes=5)
    assert health.build(now=future)["status"] == "STALE"
    store.close()
