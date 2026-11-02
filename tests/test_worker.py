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
    assert error["payload"]["execution_enabled"] is False
    assert HealthSnapshot(store).build()["status"] == "ERROR"
    store.close()
