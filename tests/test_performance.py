from trading_engine.performance import PerformanceReportingAgent
from trading_engine.positions import PositionLedger
from trading_engine.storage import SQLiteStore


def test_performance_agent_reports_only_simulated_position_ledger_events():
    store = SQLiteStore(":memory:")
    ledger = PositionLedger(store)
    ledger.open_from_fill({"simulated": True, "status": "SIMULATED_FILLED", "order_id": "SIM-1",
                           "symbol": "AAPL", "side": "BUY", "quantity": 2, "fill_price": 100},
                          stop_loss=99, take_profit=102, strategy="TREND")
    ledger.close("SIM-1", 102, "TAKE_PROFIT")
    report = PerformanceReportingAgent(store).snapshot()
    assert report["mode"] == "PAPER_SIMULATOR_LEDGER"
    assert report["closed_positions"] == 1
    assert report["winning_positions"] == 1
    assert report["win_rate_percent"] == 100.0
    assert report["realized_pnl"] == 4.0
    assert report["execution_enabled"] is False
    assert report["reconciliation_status"] == "NOT_RECONCILED"
    store.close()


def test_performance_agent_has_no_win_rate_before_closed_positions():
    store = SQLiteStore(":memory:")
    report = PerformanceReportingAgent(store).snapshot()
    assert report["closed_positions"] == 0
    assert report["win_rate_percent"] is None
    assert report["realized_pnl"] == 0.0
    store.close()
