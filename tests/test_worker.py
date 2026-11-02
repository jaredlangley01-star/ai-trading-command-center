from datetime import datetime, timezone

from trading_engine.health import HealthSnapshot
from trading_engine.market_data import InMemoryMarketDataProvider
from trading_engine.cycle import ObservationCycle
from trading_engine.storage import SQLiteStore
from trading_engine.worker import ObservationWorker


def test_worker_records_observation_events_and_heartbeat_without_execution():
    store = SQLiteStore(":memory:")
    provider = InMemoryMarketDataProvider({"AAPL": [100, 101, 102, 103, 104, 105, 106]})
    worker = ObservationWorker(ObservationCycle(provider), store, ["aapl"], interval_seconds=5)
    reports = worker.run_once()

    assert len(reports) == 1
    events = store.list_events(10)
    cycle = next(event for event in events if event["event_type"] == "OBSERVATION_CYCLE")
    assert cycle["payload"]["symbol"] == "AAPL"
    assert cycle["payload"]["execution_enabled"] is False
    assert cycle["payload"]["market"]["price"] == 106
    assert cycle["payload"]["market"]["source"] == "IN_MEMORY_FIXTURE"
    assert cycle["payload"]["market"]["timestamp"] is not None
    assert len(cycle["payload"]["signals"]) == 4
    assert any(event["event_type"] == "HEARTBEAT" for event in events)
    agent_events = [event for event in events if event["event_type"] == "AGENT_ACTIVITY"]
    assert {event["payload"]["agent"] for event in agent_events} == {"chief_orchestrator", "research", "small_trading", "risk_manager", "performance_reporting"}
    assert any(event["payload"]["phase"] == "STRATEGIES_EVALUATED" for event in agent_events)
    assert all(event["payload"]["execution_enabled"] is False for event in agent_events)
    assert HealthSnapshot(store).build()["component"] == "small-trading-observation-worker"
    store.close()


def test_worker_rejects_empty_symbol_list():
    store = SQLiteStore(":memory:")
    provider = InMemoryMarketDataProvider({"AAPL": [100, 101]})
    import pytest
    with pytest.raises(ValueError, match="AT_LEAST_ONE_SYMBOL_REQUIRED"):
        ObservationWorker(ObservationCycle(provider), store, [])
    store.close()


def test_worker_records_provider_errors_and_continues():
    class BrokenProvider:
        def latest_snapshot(self, symbol):
            raise RuntimeError("provider offline")
        def recent_closes(self, symbol, limit):
            return []

    store = SQLiteStore(":memory:")
    worker = ObservationWorker(ObservationCycle(BrokenProvider()), store, ["AAPL"])
    assert worker.run_once() == [None]
    events = store.list_events(10)
    error = next(event for event in events if event["event_type"] == "OBSERVATION_ERROR")
    assert any(event["event_type"] == "AGENT_ACTIVITY" and event["payload"]["status"] == "ERROR" for event in events)
    assert error["payload"]["execution_enabled"] is False
    assert HealthSnapshot(store).build()["status"] == "ERROR"
    store.close()



def test_worker_runs_risk_previews_but_never_approves_without_verified_portfolio_context():
    store = SQLiteStore(":memory:")
    provider = InMemoryMarketDataProvider({"AAPL": [100 + i for i in range(25)]})
    worker = ObservationWorker(ObservationCycle(provider), store, ["AAPL"])
    worker.run_once()
    cycle = next(e for e in store.list_events(100) if e["event_type"] == "OBSERVATION_CYCLE")
    directional = [s for s in cycle["payload"]["signals"] if s["status"] in {"BUY", "SELL"}]
    assert directional
    assert all(s["risk"]["status"] == "REJECTED" for s in directional)
    assert all(s["risk"]["reason"] == "PORTFOLIO_CONTEXT_UNVERIFIED" for s in directional)
    risk_events = [e for e in store.list_events(100) if e["event_type"] == "AGENT_ACTIVITY" and e["payload"]["agent"] == "risk_manager"]
    assert risk_events
    assert all(e["payload"]["execution_enabled"] is False for e in risk_events)
    assert not any(e["event_type"] == "ORDER_FILLED" for e in store.list_events(100))
    store.close()


def test_worker_position_monitor_marks_and_closes_simulated_position_on_stop():
    from trading_engine.positions import PositionLedger
    store = SQLiteStore(":memory:")
    ledger = PositionLedger(store)
    ledger.open_from_fill({
        "simulated": True, "status": "SIMULATED_FILLED", "order_id": "SIM-000001",
        "symbol": "AAPL", "side": "BUY", "quantity": 2, "fill_price": 100.0,
    }, stop_loss=99.0, take_profit=102.0, strategy="TREND")
    provider = InMemoryMarketDataProvider({"AAPL": [100, 100, 100, 98]})
    worker = ObservationWorker(ObservationCycle(provider), store, ["AAPL"])
    worker.run_once()
    closed = ledger.get("SIM-000001")
    assert closed.status == "CLOSED"
    assert closed.exit_reason == "STOP_LOSS"
    events = store.list_events(100)
    assert any(e["event_type"] == "AGENT_ACTIVITY" and e["payload"]["agent"] == "position_monitor" and e["payload"]["phase"] == "POSITION_EXIT_TRIGGERED" for e in events)
    assert not any(e["event_type"] == "ORDER_FILLED" for e in events)
    store.close()


def test_preliminary_risk_preview_does_not_invent_a_one_share_size_when_limits_allow_zero():
    from types import SimpleNamespace
    from trading_engine.models import Side
    store = SQLiteStore(":memory:")
    worker = ObservationWorker(
        ObservationCycle(InMemoryMarketDataProvider({"AAPL": [2000, 2001]})),
        store, ["AAPL"]
    )
    signal = SimpleNamespace(side=Side.BUY, strategy="TREND")
    preview = worker._risk_preview(signal, 2000.0, "AAPL", datetime.now(timezone.utc))
    assert preview["status"] == "REJECTED"
    assert preview["reason"] == "POSITION_SIZE_BELOW_MINIMUM"
    assert preview["proposed_quantity"] == 0
    assert preview["approved_quantity"] == 0
    store.close()


def test_environment_builder_defaults_to_explicit_demo_data_without_broker_credentials(monkeypatch, tmp_path):
    from trading_engine.worker import build_worker_from_environment
    monkeypatch.delenv("APCA_API_KEY_ID", raising=False)
    monkeypatch.delenv("APCA_API_SECRET_KEY", raising=False)
    monkeypatch.setenv("SMALL_TRADING_DATA_MODE", "demo")
    monkeypatch.setenv("SMALL_TRADING_SYMBOLS", "AAPL,MSFT")
    monkeypatch.setenv("SMALL_TRADING_DATABASE_PATH", str(tmp_path / "demo.db"))
    worker, store = build_worker_from_environment()
    try:
        reports = worker.run_once()
        assert len(reports) == 2
        events = store.list_events(100)
        cycles = [e for e in events if e["event_type"] == "OBSERVATION_CYCLE"]
        assert {e["payload"]["market"]["source"] for e in cycles} == {"IN_MEMORY_FIXTURE"}
        assert {e["payload"]["symbol"] for e in cycles} == {"AAPL", "MSFT"}
        assert all(e["payload"]["execution_enabled"] is False for e in cycles)
    finally:
        store.close()


def test_environment_builder_rejects_unknown_data_mode(monkeypatch, tmp_path):
    from trading_engine.worker import build_worker_from_environment
    monkeypatch.setenv("SMALL_TRADING_DATA_MODE", "unknown")
    monkeypatch.setenv("SMALL_TRADING_DATABASE_PATH", str(tmp_path / "invalid.db"))
    import pytest
    with pytest.raises(ValueError, match="SMALL_TRADING_DATA_MODE_MUST_BE"):
        build_worker_from_environment()
