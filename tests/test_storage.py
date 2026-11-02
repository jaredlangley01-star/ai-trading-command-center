from trading_engine.storage import SQLiteStore


def test_file_store_uses_wal_and_persists_events_after_reopen(tmp_path):
    database = tmp_path / "trading.db"
    store = SQLiteStore(str(database))
    assert store.append_event("AGENT_ACTIVITY", {"agent": "research", "status": "READY"}, event_key="event-1")
    assert not store.append_event("AGENT_ACTIVITY", {"agent": "research", "status": "READY"}, event_key="event-1")
    with store._connection() as connection:
        mode = connection.execute("PRAGMA journal_mode").fetchone()[0]
    assert mode.lower() == "wal"
    store.close()

    reopened = SQLiteStore(str(database))
    events = reopened.list_events(10)
    assert len(events) == 1
    assert events[0]["event_key"] == "event-1"
    assert events[0]["payload"]["status"] == "READY"
    reopened.close()


def test_memory_store_remains_isolated_and_functional():
    first = SQLiteStore(":memory:")
    second = SQLiteStore(":memory:")
    first.append_event("TEST", {"value": 1})
    assert len(first.list_events(10)) == 1
    assert second.list_events(10) == []
    first.close()
    second.close()
